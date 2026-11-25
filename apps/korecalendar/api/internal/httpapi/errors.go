package httpapi

import (
	"encoding/json"
	"net/http"
)

// errJSON writes the API's only error shape:
// {"error":{"code":"<stable_code>","message":"<text>"}}.
func errJSON(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": msg}})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
