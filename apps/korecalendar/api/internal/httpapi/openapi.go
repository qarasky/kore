package httpapi

import (
	_ "embed"
	"encoding/json"
	"net/http"
	"sync"

	"gopkg.in/yaml.v3"
)

// openAPIYAML is the API contract. docs/openapi.yaml links to this file.
//
//go:embed openapi.yaml
var openAPIYAML []byte

var (
	openAPIOnce sync.Once
	openAPIJSON []byte
	openAPIErr  error
)

func (s *server) handleOpenAPI(w http.ResponseWriter, r *http.Request) {
	openAPIOnce.Do(func() {
		var doc any
		if openAPIErr = yaml.Unmarshal(openAPIYAML, &doc); openAPIErr == nil {
			openAPIJSON, openAPIErr = json.Marshal(doc)
		}
	})
	if openAPIErr != nil {
		errJSON(w, http.StatusInternalServerError, "internal", "the API description is unavailable")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Write(openAPIJSON)
}
