import { expect, test } from "bun:test";
import { globToRegExp, workflowsFor } from "./which-workflows";

const appCi = ["kore-drive-ci", "kore-id-ci", "kore-monitor-ci", "korecalendar-ci"];

test("a kore-ui change runs every app's CI and every web image build", () => {
  const got = workflowsFor(["packages/kore-ui/src/components/Button.tsx"]);
  for (const wf of [...appCi, "kore-ui-ci", "kore-drive-images", "korecalendar-images", "kore-id-images", "kore-monitor-images"]) {
    expect(got).toContain(wf);
  }
});

test("a kore-id server change runs only kore-id's workflows", () => {
  expect(workflowsFor(["apps/kore-id/src/server.ts"])).toEqual(["kore-id-ci", "kore-id-images"]);
});

test("a KoreCalendar Android change runs its CI and Android CI, not image builds", () => {
  expect(workflowsFor(["apps/korecalendar/android/app/build.gradle.kts"])).toEqual(["korecalendar-android-ci", "korecalendar-ci"]);
});

test("a kore-monitor shared-package change rebuilds its web image", () => {
  expect(workflowsFor(["apps/kore-monitor/packages/shared/src/index.ts"])).toEqual(["kore-monitor-ci", "kore-monitor-images"]);
});

test("globs follow GitHub's rules: * stays within a path segment, ** crosses them", () => {
  expect(globToRegExp("apps/x/scripts/*android*").test("apps/x/scripts/release-android.sh")).toBe(true);
  expect(globToRegExp("apps/x/scripts/*android*").test("apps/x/scripts/sub/android.sh")).toBe(false);
  expect(globToRegExp("apps/x/**").test("apps/x/a/b/c.ts")).toBe(true);
  expect(globToRegExp("apps/x/**").test("apps/xy/c.ts")).toBe(false);
});

test("a push to main runs only the image builds of the app that changed", () => {
  expect(workflowsFor(["apps/kore-id/src/server.ts"], undefined, "push")).toEqual(["kore-id-images"]);
  expect(workflowsFor(["apps/korecalendar/api/main.go"], undefined, "push")).toEqual(["korecalendar-images"]);
});

test("a kore-ui change pushed to main rebuilds every web image and re-checks kore-ui", () => {
  const got = workflowsFor(["packages/kore-ui/theme.css"], undefined, "push");
  for (const wf of ["kore-drive-images", "korecalendar-images", "kore-id-images", "kore-monitor-images", "kore-monitor-ci", "kore-ui-ci"]) {
    expect(got).toContain(wf);
  }
});
