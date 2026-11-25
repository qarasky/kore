package httpapi

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/qarasky/korecalendar/api/internal/testutil"
	"gopkg.in/yaml.v3"
)

type operation struct {
	Summary   string         `yaml:"summary"`
	XAccess   string         `yaml:"x-access"`
	Responses map[string]any `yaml:"responses"`
}

type spec struct {
	OpenAPI     string                          `yaml:"openapi"`
	Paths       map[string]map[string]operation `yaml:"paths"`
	XErrorCodes map[string]string               `yaml:"x-error-codes"`
}

func loadSpec(t *testing.T) spec {
	t.Helper()
	var s spec
	if err := yaml.Unmarshal(openAPIYAML, &s); err != nil {
		t.Fatalf("openapi.yaml: %v", err)
	}
	return s
}

func splitPattern(p string) (method, path string) {
	m, path, _ := strings.Cut(p, " ")
	return strings.ToLower(m), path
}

func TestEveryRouteIsDocumented(t *testing.T) {
	s := loadSpec(t)
	for _, r := range (&server{}).routes() {
		method, path := splitPattern(r.pattern)
		if _, ok := s.Paths[path][method]; !ok {
			t.Errorf("%s is routed but not in openapi.yaml", r.pattern)
		}
	}
}

func TestEveryDocumentedOperationIsRouted(t *testing.T) {
	s := loadSpec(t)
	routed := map[string]bool{}
	for _, p := range Routes() {
		routed[p] = true
	}
	for path, ops := range s.Paths {
		for method := range ops {
			if !routed[strings.ToUpper(method)+" "+path] {
				t.Errorf("openapi.yaml documents %s %s but no such route exists", strings.ToUpper(method), path)
			}
		}
	}
}

func TestAccessLevelsMatchTheRouter(t *testing.T) {
	s := loadSpec(t)
	for _, r := range (&server{}).routes() {
		method, path := splitPattern(r.pattern)
		if got := s.Paths[path][method].XAccess; got != r.access.String() {
			t.Errorf("%s: openapi.yaml says x-access %q, the router uses %q", r.pattern, got, r.access)
		}
	}
}

func TestEveryOperationHasSummaryAndSuccessResponse(t *testing.T) {
	s := loadSpec(t)
	if !strings.HasPrefix(s.OpenAPI, "3.1") {
		t.Errorf("openapi version %q", s.OpenAPI)
	}
	for path, ops := range s.Paths {
		for method, op := range ops {
			ok := false
			for code := range op.Responses {
				if strings.HasPrefix(code, "2") || strings.HasPrefix(code, "3") { // 3xx: the browser redirects of sign-in
					ok = true
				}
			}
			if op.Summary == "" || !ok {
				t.Errorf("%s %s: needs a summary and a 2xx or 3xx response", strings.ToUpper(method), path)
			}
		}
	}
}

// codesInSource finds every error code a handler can emit: the third argument
// of errJSON/writeErr calls and "code": "..." entries in map literals.
func codesInSource(t *testing.T, dirs ...string) map[string]bool {
	t.Helper()
	found := map[string]bool{}
	for _, dir := range dirs {
		fset := token.NewFileSet()
		pkgs, err := parser.ParseDir(fset, dir, func(fi os.FileInfo) bool { return !strings.HasSuffix(fi.Name(), "_test.go") }, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, pkg := range pkgs {
			for _, f := range pkg.Files {
				ast.Inspect(f, func(n ast.Node) bool {
					switch x := n.(type) {
					case *ast.CallExpr:
						if id, ok := x.Fun.(*ast.Ident); ok && (id.Name == "errJSON" || id.Name == "writeErr") && len(x.Args) >= 3 {
							if lit, ok := x.Args[2].(*ast.BasicLit); ok && lit.Kind == token.STRING {
								v, _ := strconv.Unquote(lit.Value)
								found[v] = true
							}
						}
					case *ast.KeyValueExpr:
						if k, ok := x.Key.(*ast.BasicLit); ok && k.Value == `"code"` {
							if lit, ok := x.Value.(*ast.BasicLit); ok && lit.Kind == token.STRING {
								v, _ := strconv.Unquote(lit.Value)
								found[v] = true
							}
						}
					}
					return true
				})
			}
		}
	}
	return found
}

func TestErrorCodesDocumented(t *testing.T) {
	s := loadSpec(t)
	used := codesInSource(t, ".", "../auth")
	if len(used) < 10 {
		t.Fatalf("scanner found only %v", used)
	}
	var missing, stale []string
	for c := range used {
		if _, ok := s.XErrorCodes[c]; !ok {
			missing = append(missing, c)
		}
	}
	for c := range s.XErrorCodes {
		if !used[c] {
			stale = append(stale, c)
		}
	}
	sort.Strings(missing)
	sort.Strings(stale)
	if len(missing) > 0 || len(stale) > 0 {
		t.Fatalf("x-error-codes out of date: code emits %v that are undocumented; documents %v that nothing emits", missing, stale)
	}
}

func TestOpenAPIServedWithoutAuth(t *testing.T) {
	h := New(testutil.NewDB(t), t.TempDir())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/openapi.json", nil))
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("%d %v", rec.Code, rec.Header())
	}
	var doc struct {
		OpenAPI string         `json:"openapi"`
		Paths   map[string]any `json:"paths"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &doc); err != nil || !strings.HasPrefix(doc.OpenAPI, "3.1") || doc.Paths["/api/events"] == nil {
		t.Fatalf("doc %+v, err %v", doc.OpenAPI, err)
	}
}

func TestDocsOpenAPIIsTheEmbeddedFile(t *testing.T) {
	b, err := os.ReadFile("../../../docs/openapi.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != string(openAPIYAML) {
		t.Fatal("docs/openapi.yaml differs from the embedded api/internal/httpapi/openapi.yaml (it should be a link to it)")
	}
}

func TestExamplesInApiMdAreValidJSON(t *testing.T) {
	b, err := os.ReadFile("../../../docs/api.md")
	if err != nil {
		t.Fatal(err)
	}
	blocks := regexp.MustCompile("(?s)```json\n(.*?)```").FindAllStringSubmatch(string(b), -1)
	if len(blocks) < 8 {
		t.Fatalf("only %d json examples in docs/api.md", len(blocks))
	}
	for i, m := range blocks {
		var v any
		if err := json.Unmarshal([]byte(m[1]), &v); err != nil {
			t.Errorf("json example %d is not valid JSON: %v\n%s", i+1, err, m[1])
		}
	}
}
