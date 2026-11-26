//! Connectivity canary: is *this monitor's* uplink working?
//!
//! A failing check says "the target is unreachable from here". When the
//! monitor's own internet drops, every target looks down at once and the
//! operator is paged for every client site. The canary separates the two:
//! when a check fails, a few independent outside targets are probed, and
//! the failure only counts against the site when at least one of them
//! answers.
//!
//! * **Offline = every canary target failed.** One answering target is
//!   enough to call the uplink up (any HTTP response counts: the point is
//!   that a connection was made). Doubt resolves towards paging.
//! * Probes run on demand, never on a timer, and share one in-flight probe.
//!   An *online* verdict is reused for [`ONLINE_TTL`] only: a failure that
//!   happens right after the uplink dropped must not be excused by a
//!   verdict from before it. An *offline* verdict is reused for
//!   [`OFFLINE_TTL`], which is also the pace of the recovery watcher.
//! * The canary keeps when the last offline episode ended, so a check that
//!   *started* during an outage but failed after recovery is still
//!   recognised as ours ([`Canary::offline_since`]), and push monitors get
//!   a grace period for their agents to reconnect
//!   ([`Canary::grace_remaining`]).
//!
//! The canary only decides and remembers. The engine acts on it: records
//! non-alerting beats, announces transitions, watches for recovery.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde_json::{Value, json};

/// How long an online verdict may be reused.
pub const ONLINE_TTL: Duration = Duration::from_secs(3);
/// How long an offline verdict may be reused; the recovery watcher probes
/// at this pace.
pub const OFFLINE_TTL: Duration = Duration::from_secs(15);
/// Per-target timeout of one probe.
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

/// Built-in targets: three operators on different networks. Any HTTP
/// answer, whatever the status, proves a connection could be made.
pub const DEFAULT_TARGETS: [&str; 3] = [
    "https://cp.cloudflare.com/generate_204",
    "https://www.gstatic.com/generate_204",
    "https://dns.quad9.net/",
];

pub type ProbeFuture<'a> = Pin<Box<dyn Future<Output = bool> + Send + 'a>>;

/// One round of outside probes (a trait so tests can script it).
pub trait Prober: Send + Sync + 'static {
    /// `true` when at least one target answered.
    fn probe(&self) -> ProbeFuture<'_>;
}

/// Probes real HTTPS targets concurrently; the first answer wins.
struct HttpProber {
    client: reqwest::Client,
    targets: Vec<String>,
}

impl Prober for HttpProber {
    fn probe(&self) -> ProbeFuture<'_> {
        Box::pin(async move {
            let mut probes = tokio::task::JoinSet::new();
            for target in &self.targets {
                let client = self.client.clone();
                let target = target.clone();
                probes.spawn(async move { client.get(target).send().await.is_ok() });
            }
            // Dropping the set aborts the probes still running.
            while let Some(done) = probes.join_next().await {
                if done.unwrap_or(false) {
                    return true;
                }
            }
            false
        })
    }
}

/// What changed when a verdict was taken. Each transition is returned to
/// exactly one caller, so it is announced exactly once.
#[derive(Debug, Clone, PartialEq)]
pub enum Transition {
    WentOffline {
        at: DateTime<Utc>,
    },
    Recovered {
        since: DateTime<Utc>,
        duration: Duration,
        /// Failed checks and push timeouts held back during the episode.
        suppressed: u64,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Verdict {
    pub offline: bool,
    pub transition: Option<Transition>,
}

/// A snapshot for the health endpoints.
#[derive(Debug, Clone, PartialEq)]
pub struct Status {
    /// `false` while the monitor believes its own uplink is down.
    pub online: bool,
    pub offline_since: Option<DateTime<Utc>>,
    /// Age of the last probe; `None` before the first one.
    pub last_probe_age: Option<Duration>,
    /// Checks held back in the current episode.
    pub suppressed: u64,
}

impl Status {
    pub fn to_json(&self) -> Value {
        json!({
            "online": self.online,
            "offlineSince": self.offline_since.map(|at| at.to_rfc3339()),
            "lastProbeAgeMs": self.last_probe_age.map(|age| age.as_millis() as u64),
            "suppressedChecks": self.suppressed,
        })
    }
}

#[derive(Default)]
struct State {
    last_probe: Option<Instant>,
    offline: Option<Episode>,
    /// When the most recent episode ended.
    last_recovered: Option<Instant>,
    suppressed: u64,
}

struct Episode {
    started: Instant,
    at: DateTime<Utc>,
}

pub struct Canary {
    /// `None`: disabled, never offline.
    prober: Option<Arc<dyn Prober>>,
    state: Mutex<State>,
    /// One probe at a time; concurrent failures share its result.
    probing: tokio::sync::Mutex<()>,
    online_ttl: Duration,
    offline_ttl: Duration,
}

impl Canary {
    /// Probe these HTTPS targets. An empty list disables the canary.
    pub fn new(targets: Vec<String>) -> Arc<Self> {
        if targets.is_empty() {
            return Self::disabled();
        }
        let client = reqwest::Client::builder()
            .timeout(PROBE_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap_or_default();
        Self::with_prober(Arc::new(HttpProber { client, targets }))
    }

    /// Never reports an outage: every failure counts against its target.
    pub fn disabled() -> Arc<Self> {
        Arc::new(Self::build(None, ONLINE_TTL, OFFLINE_TTL))
    }

    pub fn with_prober(prober: Arc<dyn Prober>) -> Arc<Self> {
        Arc::new(Self::build(Some(prober), ONLINE_TTL, OFFLINE_TTL))
    }

    /// Test seam: custom verdict lifetimes.
    pub fn with_prober_and_ttls(
        prober: Arc<dyn Prober>,
        online_ttl: Duration,
        offline_ttl: Duration,
    ) -> Arc<Self> {
        Arc::new(Self::build(Some(prober), online_ttl, offline_ttl))
    }

    fn build(prober: Option<Arc<dyn Prober>>, online_ttl: Duration, offline_ttl: Duration) -> Self {
        Self {
            prober,
            state: Mutex::new(State::default()),
            probing: tokio::sync::Mutex::new(()),
            online_ttl,
            offline_ttl,
        }
    }

    /// The current verdict, probing when the cached one is too old.
    pub async fn check(&self) -> Verdict {
        let Some(prober) = &self.prober else {
            return Verdict {
                offline: false,
                transition: None,
            };
        };
        if let Some(offline) = self.cached() {
            return Verdict {
                offline,
                transition: None,
            };
        }

        let _one_probe = self.probing.lock().await;
        // Whoever held the lock may have just probed.
        if let Some(offline) = self.cached() {
            return Verdict {
                offline,
                transition: None,
            };
        }
        let reachable = prober.probe().await;
        self.record(reachable)
    }

    /// The cached verdict, if still fresh.
    fn cached(&self) -> Option<bool> {
        let state = self.state.lock().unwrap();
        let probed = state.last_probe?;
        let offline = state.offline.is_some();
        let ttl = if offline {
            self.offline_ttl
        } else {
            self.online_ttl
        };
        (probed.elapsed() < ttl).then_some(offline)
    }

    fn record(&self, reachable: bool) -> Verdict {
        let now = Instant::now();
        let mut state = self.state.lock().unwrap();
        state.last_probe = Some(now);
        let transition = match (reachable, state.offline.is_some()) {
            (false, false) => {
                let at = Utc::now();
                state.offline = Some(Episode { started: now, at });
                state.suppressed = 0;
                Some(Transition::WentOffline { at })
            }
            (true, true) => {
                let episode = state.offline.take().expect("checked above");
                state.last_recovered = Some(now);
                Some(Transition::Recovered {
                    since: episode.at,
                    duration: now.saturating_duration_since(episode.started),
                    suppressed: state.suppressed,
                })
            }
            _ => None,
        };
        Verdict {
            offline: state.offline.is_some(),
            transition,
        }
    }

    /// Was the uplink down at any moment since `since`? True while offline,
    /// and after recovery for checks that were already running when it
    /// dropped.
    pub fn offline_since(&self, since: Instant) -> bool {
        let state = self.state.lock().unwrap();
        state.offline.is_some() || state.last_recovered.is_some_and(|ended| ended >= since)
    }

    /// Time left of a `grace` period that began when the last episode ended;
    /// `None` when there is none (never offline, or the grace is over).
    pub fn grace_remaining(&self, grace: Duration) -> Option<Duration> {
        let state = self.state.lock().unwrap();
        if state.offline.is_some() {
            return Some(grace);
        }
        let recovered = state.last_recovered?;
        grace
            .checked_sub(recovered.elapsed())
            .filter(|d| !d.is_zero())
    }

    /// How often to look again while offline: the offline verdict's
    /// lifetime, so every look is a fresh probe.
    pub fn recheck_interval(&self) -> Duration {
        self.offline_ttl
    }

    /// Count one check held back during the current episode.
    pub fn note_suppressed(&self) {
        let mut state = self.state.lock().unwrap();
        if state.offline.is_some() {
            state.suppressed += 1;
        }
    }

    pub fn status(&self) -> Status {
        let state = self.state.lock().unwrap();
        Status {
            online: state.offline.is_none(),
            offline_since: state.offline.as_ref().map(|episode| episode.at),
            last_probe_age: state.last_probe.map(|probed| probed.elapsed()),
            suppressed: state.suppressed,
        }
    }
}

#[cfg(test)]
pub(crate) mod fake {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use super::*;

    /// A prober the test flips between reachable and not.
    pub struct FakeProber {
        pub reachable: AtomicBool,
        pub probes: AtomicUsize,
        pub delay: Duration,
    }

    impl FakeProber {
        pub fn new(reachable: bool) -> Arc<Self> {
            Arc::new(Self {
                reachable: AtomicBool::new(reachable),
                probes: AtomicUsize::new(0),
                delay: Duration::ZERO,
            })
        }

        pub fn set(&self, reachable: bool) {
            self.reachable.store(reachable, Ordering::SeqCst);
        }

        pub fn count(&self) -> usize {
            self.probes.load(Ordering::SeqCst)
        }
    }

    impl Prober for FakeProber {
        fn probe(&self) -> ProbeFuture<'_> {
            Box::pin(async move {
                self.probes.fetch_add(1, Ordering::SeqCst);
                if !self.delay.is_zero() {
                    tokio::time::sleep(self.delay).await;
                }
                self.reachable.load(Ordering::SeqCst)
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fake::FakeProber;
    use super::*;

    /// No caching: every `check` probes.
    fn uncached(prober: &Arc<FakeProber>) -> Arc<Canary> {
        Canary::with_prober_and_ttls(prober.clone(), Duration::ZERO, Duration::ZERO)
    }

    #[tokio::test]
    async fn all_targets_failing_is_offline_and_one_answer_is_online() {
        let prober = FakeProber::new(false);
        let canary = uncached(&prober);

        let verdict = canary.check().await;
        assert!(verdict.offline);
        assert!(matches!(
            verdict.transition,
            Some(Transition::WentOffline { .. })
        ));

        // Still offline: no second announcement.
        let verdict = canary.check().await;
        assert!(verdict.offline);
        assert_eq!(verdict.transition, None);

        prober.set(true);
        let verdict = canary.check().await;
        assert!(!verdict.offline);
        assert!(matches!(
            verdict.transition,
            Some(Transition::Recovered { .. })
        ));
        assert_eq!(canary.check().await.transition, None);
    }

    #[tokio::test]
    async fn a_disabled_canary_never_reports_an_outage() {
        let canary = Canary::disabled();
        let verdict = canary.check().await;
        assert!(!verdict.offline);
        assert_eq!(verdict.transition, None);
        assert!(Canary::new(vec![]).check().await.transition.is_none());
    }

    #[tokio::test]
    async fn verdicts_are_cached_and_online_expires_faster_than_offline() {
        let prober = FakeProber::new(true);
        let canary = Canary::with_prober_and_ttls(
            prober.clone(),
            Duration::from_millis(60),
            Duration::from_millis(400),
        );
        canary.check().await;
        canary.check().await;
        assert_eq!(prober.count(), 1, "the online verdict is reused");

        tokio::time::sleep(Duration::from_millis(90)).await;
        prober.set(false);
        assert!(canary.check().await.offline, "online expired: probed again");
        assert_eq!(prober.count(), 2);

        // Offline is reused for longer, even once the uplink is back.
        prober.set(true);
        tokio::time::sleep(Duration::from_millis(90)).await;
        assert!(canary.check().await.offline);
        assert_eq!(prober.count(), 2);
        tokio::time::sleep(Duration::from_millis(350)).await;
        assert!(!canary.check().await.offline);
        assert_eq!(prober.count(), 3);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn simultaneous_failures_share_one_probe() {
        let prober = Arc::new(FakeProber {
            reachable: false.into(),
            probes: 0.into(),
            delay: Duration::from_millis(100),
        });
        let canary = Canary::with_prober(prober.clone());
        let mut tasks = Vec::new();
        for _ in 0..20 {
            let canary = Arc::clone(&canary);
            tasks.push(tokio::spawn(async move { canary.check().await }));
        }
        let mut announced = 0;
        for task in tasks {
            let verdict = task.await.unwrap();
            assert!(verdict.offline);
            announced += verdict.transition.is_some() as usize;
        }
        assert_eq!(prober.count(), 1, "one probe for the whole burst");
        assert_eq!(announced, 1, "the transition is announced once");
    }

    #[tokio::test]
    async fn recovery_reports_the_episode_and_what_it_held_back() {
        let prober = FakeProber::new(false);
        let canary = uncached(&prober);
        canary.check().await;
        canary.note_suppressed();
        canary.note_suppressed();
        tokio::time::sleep(Duration::from_millis(30)).await;
        prober.set(true);
        match canary.check().await.transition {
            Some(Transition::Recovered {
                duration,
                suppressed,
                ..
            }) => {
                assert!(duration >= Duration::from_millis(30), "{duration:?}");
                assert_eq!(suppressed, 2);
            }
            other => panic!("expected recovery, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn a_check_that_started_during_the_outage_still_counts_as_ours() {
        let prober = FakeProber::new(true);
        let canary = uncached(&prober);
        canary.check().await;
        assert!(
            !canary.offline_since(Instant::now()),
            "never offline: failures count"
        );

        let started = Instant::now();
        prober.set(false);
        canary.check().await;
        assert!(canary.offline_since(started), "offline now");
        prober.set(true);
        canary.check().await;
        assert!(
            canary.offline_since(started),
            "recovered after the check began: the failure was the outage's"
        );

        tokio::time::sleep(Duration::from_millis(5)).await;
        assert!(
            !canary.offline_since(Instant::now()),
            "a check that began after recovery is judged on its own"
        );
    }

    #[tokio::test]
    async fn the_grace_period_runs_from_recovery() {
        let prober = FakeProber::new(true);
        let canary = uncached(&prober);
        canary.check().await;
        assert_eq!(canary.grace_remaining(Duration::from_secs(60)), None);

        prober.set(false);
        canary.check().await;
        assert_eq!(
            canary.grace_remaining(Duration::from_secs(60)),
            Some(Duration::from_secs(60)),
            "the whole grace is still ahead while offline"
        );

        prober.set(true);
        canary.check().await;
        let left = canary.grace_remaining(Duration::from_secs(60)).unwrap();
        assert!(left > Duration::from_secs(59) && left <= Duration::from_secs(60));
        assert_eq!(canary.grace_remaining(Duration::from_millis(0)), None);
    }

    #[tokio::test]
    async fn status_serialises_for_the_health_endpoints() {
        let prober = FakeProber::new(false);
        let canary = uncached(&prober);
        assert_eq!(canary.status().to_json()["online"], true);
        assert!(canary.status().to_json()["lastProbeAgeMs"].is_null());

        canary.check().await;
        let json = canary.status().to_json();
        assert_eq!(json["online"], false);
        assert!(json["offlineSince"].as_str().is_some(), "{json}");
        assert!(json["lastProbeAgeMs"].as_u64().is_some());
        assert_eq!(json["suppressedChecks"], 0);
    }
}
