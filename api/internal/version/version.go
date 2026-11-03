// Package version holds the release the binary was built from. The Dockerfile
// and the images workflow stamp it with -ldflags "-X ...Version=1.2.3 -X ...Commit=<sha>";
// an unstamped build (go run, go test) reports "dev".
package version

var (
	// Version is the release number without the leading "v", "edge" for a build of main, or "dev".
	Version = "dev"
	// Commit is the full git commit the binary was built from, or "".
	Commit = ""
)

// String is "1.2.3 (0123456)", or just the version when the commit is unknown.
func String() string {
	if len(Commit) < 7 {
		return Version
	}
	return Version + " (" + Commit[:7] + ")"
}
