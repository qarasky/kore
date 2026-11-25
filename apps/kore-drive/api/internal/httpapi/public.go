package httpapi

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"mime"
	"net/http"
	"sync"
	"time"

	"github.com/qarasky/kore/api/internal/auth"
	"github.com/qarasky/kore/api/internal/nodes"
	"github.com/qarasky/kore/api/internal/settings"
	"github.com/qarasky/kore/api/internal/shares"
	"github.com/qarasky/kore/api/internal/transfer"
	"github.com/qarasky/kore/api/internal/users"
)

// publicPrefix is where anonymous share-link routes live. Requests under it
// never pass the session middleware (see handler).
const publicPrefix = "/api/public/"

// publicHeaders go on every public response.
func publicHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Cache-Control", "no-store")
	h.Set("X-Robots-Tag", "noindex, nofollow")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("X-Content-Type-Options", "nosniff")
}

func (s *server) registerPublic(mux *http.ServeMux) {
	p := "/api/public/shares/{token}"
	mux.HandleFunc("GET "+p, s.public(s.pubMeta, false))
	mux.HandleFunc("POST "+p+"/unlock", s.public(s.pubUnlock, false))
	mux.HandleFunc("GET "+p+"/children", s.public(s.pubChildren, true))
	mux.HandleFunc("GET "+p+"/download", s.public(s.pubDownload, true))
	mux.HandleFunc("GET "+p+"/zip", s.public(s.pubZip, true))
	mux.HandleFunc("GET "+p+"/preview", s.public(s.pubPreview, true))
	mux.HandleFunc("GET "+p+"/view", s.public(s.pubView, true))
}

// pubShare is a share resolved for one public request.
type pubShare struct {
	shares.Share
	token    string
	root     nodes.Node
	unlocked bool
}

// resolveShare loads and re-validates the share on every request: feature
// on, token known, not revoked, not expired, creator still has access, root
// node live. On failure it has written the error.
func (s *server) resolveShare(w http.ResponseWriter, r *http.Request) (pubShare, bool) {
	ctx := r.Context()
	if !settings.ShareLinksEnabled(ctx, s.db) {
		errJSON(w, 403, "shares_disabled")
		return pubShare{}, false
	}
	tok := r.PathValue("token")
	if !shares.ValidToken(tok) {
		errJSON(w, 404, "not_found")
		return pubShare{}, false
	}
	sh, err := shares.ByToken(ctx, s.db, tok)
	if errors.Is(err, shares.ErrNotFound) {
		errJSON(w, 404, "not_found")
		return pubShare{}, false
	}
	if err != nil {
		log.Printf("public share lookup: %v", err)
		errJSON(w, 500, "internal")
		return pubShare{}, false
	}
	switch sh.Status(s.now()) {
	case shares.StatusActive:
	case shares.StatusRevoked:
		errJSON(w, 410, "revoked")
		return pubShare{}, false
	case shares.StatusExpired:
		errJSON(w, 410, "expired")
		return pubShare{}, false
	default:
		errJSON(w, 410, "unavailable")
		return pubShare{}, false
	}
	// The creator as a bare actor: nodes access rules then apply exactly as
	// they would to the creator (never as an admin).
	root, err := nodes.Get(ctx, s.db, s.creator(sh), sh.NodeID)
	if err != nil {
		errJSON(w, 410, "unavailable")
		return pubShare{}, false
	}
	ps := pubShare{Share: sh, token: tok, root: root, unlocked: sh.PasswordHash == nil}
	if !ps.unlocked {
		if c, err := r.Cookie(shares.CookieName(sh.ID)); err == nil {
			ps.unlocked = shares.VerifyUnlock(s.shareSecret, sh.ID, *sh.PasswordHash, c.Value, s.now())
		}
	}
	return ps, true
}

func (s *server) creator(sh shares.Share) users.User {
	return users.User{ID: sh.CreatedBy, Role: "user"}
}

// public wraps a public handler: per-IP rate limit, share resolution and
// (when needContent) the password gate.
func (s *server) public(h func(http.ResponseWriter, *http.Request, pubShare), needContent bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Keyed by the real client (behind Caddy and the SSR page, the
		// forwarded address; IPv6 grouped by /64): one visitor can only
		// use up their own budget, whatever tokens they try.
		if !s.publicLimit.Attempt("pub|" + limitKey(r)) {
			w.Header().Set("Retry-After", "60")
			errJSON(w, 429, "rate_limited")
			return
		}
		ps, ok := s.resolveShare(w, r)
		if !ok {
			return
		}
		if needContent && !ps.unlocked {
			errJSON(w, 401, "password_required")
			return
		}
		h(w, r, ps)
	}
}

type pubMetaJSON struct {
	Name        string `json:"name,omitempty"`
	IsDir       *bool  `json:"is_dir,omitempty"`
	Size        *int64 `json:"size,omitempty"`
	Mime        string `json:"mime,omitempty"`
	ExpiresAt   *int64 `json:"expires_at"`
	HasPassword bool   `json:"has_password"`
	Unlocked    bool   `json:"unlocked"`
	Status      string `json:"status"`
}

func (s *server) pubMeta(w http.ResponseWriter, r *http.Request, ps pubShare) {
	out := pubMetaJSON{ExpiresAt: ps.ExpiresAt, HasPassword: ps.PasswordHash != nil, Unlocked: ps.unlocked,
		Status: shares.StatusActive}
	if ps.unlocked {
		size := ps.root.Size
		if ps.root.IsDir {
			// One recursive total per share per minute at most (cached), so
			// anonymous reloads can't keep the database busy.
			now := s.now()
			total, ok := s.sizeCache.get(ps.ID, now)
			if !ok {
				var err error
				if total, err = s.folderTotal(r.Context(), ps.root.ID); err != nil {
					errJSON(w, 500, "internal")
					return
				}
				s.sizeCache.put(ps.ID, total, now)
			}
			size = total
		}
		out.Name, out.IsDir, out.Size, out.Mime = ps.root.Name, &ps.root.IsDir, &size, ps.root.Mime
	}
	writeJSON(w, 200, out)
}

// folderTotal sums the live files below a folder (trashed subtrees skipped).
func (s *server) folderTotal(ctx context.Context, id string) (int64, error) {
	var total int64
	err := s.db.QueryRowContext(ctx, `WITH RECURSIVE d(id,is_dir,size) AS (
		SELECT id,1,0 FROM nodes WHERE id=?
		UNION ALL SELECT n.id,n.is_dir,n.size FROM nodes n JOIN d ON n.parent_id=d.id
		WHERE d.is_dir=1 AND n.trashed_at IS NULL AND n.trash_root IS NULL)
		SELECT COALESCE(SUM(size),0) FROM d WHERE is_dir=0`, id).Scan(&total)
	return total, err
}

func (s *server) pubUnlock(w http.ResponseWriter, r *http.Request, ps pubShare) {
	var in struct {
		Password string `json:"password"`
	}
	if !requireJSON(w, r) || !decode(w, r, &in) {
		return
	}
	if ps.PasswordHash == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	// Three budgets: per client address across all links (su|, separate
	// from login), per address on this link, and per link from any
	// address (stops a distributed guess at one password). Each is
	// reserved up front; a success or a busy hash pool gives back what it
	// took, so only wrong passwords count.
	ip := limitKey(r)
	ipKey, key, failKey := "su|"+ip, "su|"+ip+"|"+ps.ID, "sf|"+ps.ID
	if !s.ipLimit.Attempt(ipKey) {
		tooMany(w)
		return
	}
	if !s.shareLimit.Attempt(key) {
		s.ipLimit.Forgive(ipKey)
		tooMany(w)
		return
	}
	if !s.shareFail.Attempt(failKey) {
		s.ipLimit.Forgive(ipKey)
		s.shareLimit.Forgive(key)
		tooMany(w)
		return
	}
	ok, err := auth.VerifyPassword(*ps.PasswordHash, in.Password)
	if err != nil || ok {
		s.ipLimit.Forgive(ipKey)
		s.shareLimit.Forgive(key)
		s.shareFail.Forgive(failKey)
	}
	if err != nil {
		hashErr(w, err)
		return
	}
	if !ok {
		errJSON(w, 403, "wrong_password")
		return
	}
	s.shareLimit.Reset(key)
	exp := s.now().Add(shares.UnlockTTL)
	val := shares.SignUnlock(s.shareSecret, ps.ID, *ps.PasswordHash, exp)
	// One cookie for the API routes of this share, one for its page (the
	// SSR page forwards only kore_share_* cookies to the API).
	for _, path := range []string{"/api/public/shares/" + ps.token, "/s/" + ps.token} {
		http.SetCookie(w, &http.Cookie{
			Name: shares.CookieName(ps.ID), Value: val, Path: path, HttpOnly: true,
			SameSite: http.SameSiteLaxMode, Secure: auth.IsHTTPS(r), Expires: exp,
		})
	}
	w.WriteHeader(http.StatusNoContent)
}

// inShare returns the chain of live nodes from the share root down to id
// (inclusive), or ErrNotFound when id is not the root or a live descendant
// of it. One recursive query walks up from id and stops at the root; a
// trashed node anywhere on the way breaks the chain.
func (s *server) inShare(ctx context.Context, ps pubShare, id string) ([]nodes.Node, error) {
	if id == "" || id == ps.root.ID {
		return []nodes.Node{ps.root}, nil
	}
	rows, err := s.db.QueryContext(ctx, `WITH RECURSIVE a(id,parent_id,depth) AS (
		SELECT id,parent_id,0 FROM nodes WHERE id=?1 AND trashed_at IS NULL AND trash_root IS NULL
		UNION ALL
		SELECT n.id,n.parent_id,a.depth+1 FROM nodes n JOIN a ON n.id=a.parent_id
		WHERE a.id<>?2 AND n.trashed_at IS NULL AND n.trash_root IS NULL AND a.depth<10000)
		SELECT n.id,n.name,n.is_dir,n.size,n.blob_id,n.mime,n.updated_at,n.space_owner
		FROM a JOIN nodes n ON n.id=a.id ORDER BY a.depth DESC`, id, ps.root.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var chain []nodes.Node
	for rows.Next() {
		var n nodes.Node
		var dir int
		var blob, owner sql.NullString
		if err := rows.Scan(&n.ID, &n.Name, &dir, &n.Size, &blob, &n.Mime, &n.UpdatedAt, &owner); err != nil {
			return nil, err
		}
		n.IsDir = dir != 0
		if blob.Valid {
			n.BlobID = &blob.String
		}
		if owner.Valid {
			n.SpaceOwner = &owner.String
		}
		chain = append(chain, n)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(chain) < 2 || chain[0].ID != ps.root.ID {
		return nil, nodes.ErrNotFound
	}
	return chain, nil
}

// pubNode resolves ?node= (default: the root) within the share; on failure
// it has written 404.
func (s *server) pubNode(w http.ResponseWriter, r *http.Request, ps pubShare, param string) ([]nodes.Node, bool) {
	chain, err := s.inShare(r.Context(), ps, r.URL.Query().Get(param))
	if errors.Is(err, nodes.ErrNotFound) {
		errJSON(w, 404, "not_found")
		return nil, false
	}
	if err != nil {
		log.Printf("public share %s: scope: %v", ps.ID, err)
		errJSON(w, 500, "internal")
		return nil, false
	}
	return chain, true
}

type pubNodeJSON struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	IsDir     bool   `json:"is_dir"`
	Size      int64  `json:"size"`
	Mime      string `json:"mime"`
	UpdatedAt int64  `json:"updated_at"`
}

type crumbJSON struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func (s *server) pubChildren(w http.ResponseWriter, r *http.Request, ps pubShare) {
	chain, ok := s.pubNode(w, r, ps, "folder")
	if !ok {
		return
	}
	dir := chain[len(chain)-1]
	if !dir.IsDir {
		errJSON(w, 404, "not_found")
		return
	}
	// nodes.ListWithoutSizes with the creator as actor: same live filter
	// and natural order as the app, but no recursive folder totals
	// (anonymous listings must stay cheap; folders report 0).
	list, err := nodes.ListWithoutSizes(r.Context(), s.db, s.creator(ps.Share), nodes.SpaceOf(ps.root), &dir.ID)
	if errors.Is(err, nodes.ErrNotFound) {
		errJSON(w, 404, "not_found")
		return
	}
	if err != nil {
		log.Printf("public share %s: list: %v", ps.ID, err)
		errJSON(w, 500, "internal")
		return
	}
	out := struct {
		Folder     pubNodeJSON   `json:"folder"`
		Breadcrumb []crumbJSON   `json:"breadcrumb"`
		Children   []pubNodeJSON `json:"children"`
	}{Folder: pubNodeJSON{dir.ID, dir.Name, true, 0, "", dir.UpdatedAt}, Children: make([]pubNodeJSON, len(list))}
	for _, c := range chain {
		out.Breadcrumb = append(out.Breadcrumb, crumbJSON{c.ID, c.Name})
	}
	for i, n := range list {
		out.Children[i] = pubNodeJSON{n.ID, n.Name, n.IsDir, n.Size, n.Mime, n.UpdatedAt}
	}
	writeJSON(w, 200, out)
}

// pubFile resolves ?node= to a file within the share.
func (s *server) pubFile(w http.ResponseWriter, r *http.Request, ps pubShare) (nodes.Node, bool) {
	chain, ok := s.pubNode(w, r, ps, "node")
	if !ok {
		return nodes.Node{}, false
	}
	n := chain[len(chain)-1]
	if n.IsDir {
		errJSON(w, 400, "is_directory")
		return n, false
	}
	return n, true
}

// countDownload records a full download in the background (best effort,
// 1 s budget), so it never delays the stream.
func (s *server) countDownload(ps pubShare) {
	now := s.now().Unix()
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := shares.CountDownload(ctx, s.db, ps.ID, now); err != nil {
			log.Printf("public share %s: count: %v", ps.ID, err)
		}
	}()
}

// streamIdle is how long a public stream may make no write progress
// before the connection is dropped.
const streamIdle = 60 * time.Second

// pubStream wraps a public download/zip response: every write pushes the
// connection's write deadline streamIdle ahead (a stalled reader is cut
// off), and onStart runs once when a 200 starts streaming.
type pubStream struct {
	http.ResponseWriter
	rc      *http.ResponseController
	onStart func()
	started bool
}

func (s *server) newStream(w http.ResponseWriter, r *http.Request, ps pubShare) *pubStream {
	st := &pubStream{ResponseWriter: w, rc: http.NewResponseController(w)}
	if r.Method == http.MethodGet && r.Header.Get("Range") == "" {
		st.onStart = func() { s.countDownload(ps) }
	}
	return st
}

func (w *pubStream) WriteHeader(code int) {
	if !w.started {
		w.started = true
		if code == http.StatusOK && w.onStart != nil {
			w.onStart()
		}
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *pubStream) Write(b []byte) (int, error) {
	if !w.started {
		w.WriteHeader(http.StatusOK)
	}
	_ = w.rc.SetWriteDeadline(time.Now().Add(streamIdle)) // unsupported in tests: ignore
	return w.ResponseWriter.Write(b)
}

func (w *pubStream) Flush() { _ = w.rc.Flush() }

// Unwrap lets http.ResponseController reach the underlying writer.
func (w *pubStream) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (s *server) pubDownload(w http.ResponseWriter, r *http.Request, ps pubShare) {
	n, ok := s.pubFile(w, r, ps)
	if !ok {
		return
	}
	transfer.ServeDownload(s.newStream(w, r, ps), r, s.dataDir, n)
}

func (s *server) pubView(w http.ResponseWriter, r *http.Request, ps pubShare) {
	if n, ok := s.pubFile(w, r, ps); ok {
		transfer.ServeView(w, r, s.dataDir, n)
	}
}

func (s *server) pubPreview(w http.ResponseWriter, r *http.Request, ps pubShare) {
	if n, ok := s.pubFile(w, r, ps); ok {
		s.servePreview(w, n)
	}
}

func (s *server) pubZip(w http.ResponseWriter, r *http.Request, ps pubShare) {
	chain, ok := s.pubNode(w, r, ps, "node")
	if !ok {
		return
	}
	dir := chain[len(chain)-1]
	if !dir.IsDir {
		errJSON(w, 400, "not_a_folder")
		return
	}
	// At most one running zip per client address, four in total.
	ip := limitKey(r)
	s.zipMu.Lock()
	if s.zipByIP[ip] > 0 {
		s.zipMu.Unlock()
		busy(w)
		return
	}
	s.zipByIP[ip]++
	s.zipMu.Unlock()
	defer func() {
		s.zipMu.Lock()
		if s.zipByIP[ip]--; s.zipByIP[ip] <= 0 {
			delete(s.zipByIP, ip)
		}
		s.zipMu.Unlock()
	}()
	select {
	case s.zipSlots <- struct{}{}:
		defer func() { <-s.zipSlots }()
	default:
		busy(w)
		return
	}
	transfer.ServeZip(s.newStream(w, r, ps), r, s.db, s.dataDir, []nodes.Node{dir})
}

func tooMany(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "900")
	errJSON(w, 429, "too_many_attempts")
}

// sizeCache keeps shared-folder totals for a short time, bounded in size.
type sizeCache struct {
	mu   sync.Mutex
	max  int
	ttl  time.Duration
	data map[string]sizeEntry
}

type sizeEntry struct {
	total int64
	at    time.Time
}

func newSizeCache(max int, ttl time.Duration) *sizeCache {
	return &sizeCache{max: max, ttl: ttl, data: map[string]sizeEntry{}}
}

func (c *sizeCache) get(id string, now time.Time) (int64, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.data[id]
	if !ok || now.Sub(e.at) >= c.ttl || now.Before(e.at) {
		return 0, false
	}
	return e.total, true
}

func (c *sizeCache) put(id string, total int64, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.data) >= c.max {
		for k, e := range c.data {
			if now.Sub(e.at) >= c.ttl {
				delete(c.data, k)
			}
		}
		if len(c.data) >= c.max {
			clear(c.data)
		}
	}
	c.data[id] = sizeEntry{total, now}
}

// requireJSON refuses a mutating request whose body is not declared JSON
// (415 unsupported_media_type): a cross-site form can't send it.
func requireJSON(w http.ResponseWriter, r *http.Request) bool {
	if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
		errJSON(w, 415, "unsupported_media_type")
		return false
	}
	return true
}
