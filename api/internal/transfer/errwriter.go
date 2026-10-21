package transfer

import (
	"encoding/json"
	"io"
	"net/http"
)

// jsonErrorWriter wraps the ResponseWriter handed to http.ServeContent so
// its error replies (416 unsatisfiable Range, 412 failed precondition, ...)
// are JSON {"error":"<code>"} like every other API error instead of
// text/plain. Successful 200/206/304 replies pass through untouched.
type jsonErrorWriter struct {
	http.ResponseWriter
	failed bool
}

func errorCode(status int) string {
	switch status {
	case http.StatusRequestedRangeNotSatisfiable:
		return "range_not_satisfiable"
	case http.StatusPreconditionFailed:
		return "precondition_failed"
	}
	if status >= 500 {
		return "internal"
	}
	return "bad_request"
}

func (w *jsonErrorWriter) WriteHeader(status int) {
	if w.failed {
		return
	}
	if status < 400 {
		w.ResponseWriter.WriteHeader(status)
		return
	}
	w.failed = true
	h := w.Header()
	for _, k := range []string{"Content-Disposition", "Content-Length", "Content-Encoding", "Last-Modified", "Etag"} {
		h.Del(k)
	}
	h.Set("Content-Type", "application/json")
	w.ResponseWriter.WriteHeader(status)
	json.NewEncoder(w.ResponseWriter).Encode(map[string]string{"error": errorCode(status)})
}

// Write drops ServeContent's plain-text error message once a JSON error was sent.
func (w *jsonErrorWriter) Write(b []byte) (int, error) {
	if w.failed {
		return len(b), nil
	}
	return w.ResponseWriter.Write(b)
}

// ReadFrom keeps the underlying writer's sendfile fast path.
func (w *jsonErrorWriter) ReadFrom(r io.Reader) (int64, error) {
	if rf, ok := w.ResponseWriter.(io.ReaderFrom); ok && !w.failed {
		return rf.ReadFrom(r)
	}
	return io.Copy(struct{ io.Writer }{w}, r)
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (w *jsonErrorWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
