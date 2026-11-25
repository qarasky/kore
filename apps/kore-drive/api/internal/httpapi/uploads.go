package httpapi

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/qarasky/kore/api/internal/auth"
	"github.com/qarasky/kore/api/internal/quota"
	"github.com/qarasky/kore/api/internal/uploads"
)

func (s *server) registerUploads(mux *http.ServeMux) {
	mux.Handle("POST /api/uploads", auth.RequireUser(http.HandlerFunc(s.createUpload)))
	mux.Handle("HEAD /api/uploads/{id}", auth.RequireUser(http.HandlerFunc(s.headUpload)))
	mux.Handle("PATCH /api/uploads/{id}", auth.RequireUser(http.HandlerFunc(s.patchUpload)))
	mux.Handle("POST /api/uploads/{id}/complete", auth.RequireUser(http.HandlerFunc(s.completeUpload)))
	mux.Handle("DELETE /api/uploads/{id}", auth.RequireUser(http.HandlerFunc(s.cancelUpload)))
}

func uploadErr(w http.ResponseWriter, err error) {
	var oe *uploads.OffsetError
	switch {
	case errors.As(err, &oe):
		w.Header().Set("Upload-Offset", strconv.FormatInt(oe.Expected, 10))
		errJSON(w, 409, "offset_mismatch")
	case errors.Is(err, uploads.ErrNotFound):
		errJSON(w, 404, "not_found")
	case errors.Is(err, uploads.ErrTooLarge):
		errJSON(w, 413, "file_too_large")
	case errors.Is(err, uploads.ErrChunkTooLarge):
		errJSON(w, 413, "chunk_too_large")
	case errors.Is(err, uploads.ErrExceedsSize):
		errJSON(w, 413, "exceeds_upload_size")
	case errors.Is(err, quota.ErrExceeded):
		errJSON(w, 507, "quota_exceeded")
	case errors.Is(err, uploads.ErrInvalidSize):
		errJSON(w, 400, "invalid_size")
	case errors.Is(err, uploads.ErrInvalidChunkSize):
		errJSON(w, 400, "invalid_chunk_size")
	case errors.Is(err, uploads.ErrIncomplete):
		errJSON(w, 409, "incomplete")
	case errors.Is(err, uploads.ErrBusy):
		errJSON(w, 423, "upload_busy")
	case errors.Is(err, uploads.ErrCorrupt):
		errJSON(w, 500, "upload_corrupt")
	default:
		nodeErr(w, err) // nodes errors (not_found, invalid_name, not_a_folder) or 500
	}
}

func (s *server) createUpload(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	var in struct {
		Space     string  `json:"space"`
		Parent    *string `json:"parent"`
		Name      string  `json:"name"`
		Size      int64   `json:"size"`
		ChunkSize int64   `json:"chunk_size"`
	}
	if !decode(w, r, &in) {
		return
	}
	sp, ok := spaceFor(in.Space, me.ID)
	if !ok {
		errJSON(w, 400, "invalid_space")
		return
	}
	if in.Parent != nil && *in.Parent == "" {
		in.Parent = nil
	}
	up, err := s.uploads.Create(r.Context(), me, sp, in.Parent, in.Name, in.Size, in.ChunkSize)
	if err != nil {
		uploadErr(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{
		"id": up.ID, "received_bytes": up.ReceivedBytes, "size": up.Size, "chunk_size": up.ChunkSize,
	})
}

func (s *server) headUpload(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	up, err := s.uploads.Get(r.Context(), me, r.PathValue("id"))
	if err != nil {
		uploadErr(w, err)
		return
	}
	h := w.Header()
	h.Set("Cache-Control", "no-store")
	h.Set("Upload-Offset", strconv.FormatInt(up.ReceivedBytes, 10))
	h.Set("Upload-Length", strconv.FormatInt(up.Size, 10))
	h.Set("Upload-Chunk-Size", strconv.FormatInt(up.ChunkSize, 10))
	w.WriteHeader(http.StatusOK)
}

func (s *server) patchUpload(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	id := r.PathValue("id")
	off, err := strconv.ParseInt(r.Header.Get("Upload-Offset"), 10, 64)
	if err != nil || off < 0 {
		errJSON(w, 400, "invalid_offset")
		return
	}
	// Reject a declared oversized body before reading it.
	up, err := s.uploads.Get(r.Context(), me, id)
	if err != nil {
		uploadErr(w, err)
		return
	}
	if r.ContentLength > up.ChunkSize {
		errJSON(w, 413, "chunk_too_large")
		return
	}
	// The server has no global read timeout (uploads and downloads stream),
	// so bound how long a chunk body may stall: a dead client would
	// otherwise hold the upload's lock (423 upload_busy on resume) until TCP
	// gives up.
	body := chunkBody(w, r)
	next, err := s.uploads.Append(r.Context(), me, id, off, body)
	if err != nil {
		uploadErr(w, err)
		return
	}
	w.Header().Set("Upload-Offset", strconv.FormatInt(next, 10))
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) completeUpload(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	n, err := s.uploads.Complete(r.Context(), me, r.PathValue("id"))
	if err != nil {
		uploadErr(w, err)
		return
	}
	writeJSON(w, 201, toJSON(n))
}

func (s *server) cancelUpload(w http.ResponseWriter, r *http.Request) {
	me, _ := auth.FromContext(r.Context())
	if err := s.uploads.Cancel(r.Context(), me, r.PathValue("id")); err != nil {
		uploadErr(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// chunkIdleTimeout is how long a chunk body may go without delivering any
// bytes before the read fails and the upload's lock is released.
var chunkIdleTimeout = time.Minute

// chunkBody returns r.Body behind an idle read deadline (see
// idleDeadlineReader), or r.Body itself if the connection has no deadlines.
func chunkBody(w http.ResponseWriter, r *http.Request) io.Reader {
	rc := http.NewResponseController(w)
	if rc.SetReadDeadline(time.Now().Add(chunkIdleTimeout)) != nil {
		return r.Body
	}
	return &idleDeadlineReader{r: r.Body, rc: rc}
}

// idleDeadlineReader pushes the connection's read deadline forward before
// every read, so a slow but progressing chunk is never cut off while a
// stalled one fails after chunkIdleTimeout. Once the body hits EOF it clears
// the deadline and stops touching it: net/http then starts a background read
// on the connection, and a deadline (re-)armed under it, e.g. by Append's
// read past the chunk limit, would fail that read and cancel the request
// context during the fsync and DB update.
type idleDeadlineReader struct {
	r    io.Reader
	rc   *http.ResponseController
	done bool
}

func (d *idleDeadlineReader) Read(p []byte) (int, error) {
	if d.done {
		return d.r.Read(p)
	}
	if err := d.rc.SetReadDeadline(time.Now().Add(chunkIdleTimeout)); err != nil {
		return 0, err
	}
	n, err := d.r.Read(p)
	if err == io.EOF {
		d.done = true
		if cerr := d.rc.SetReadDeadline(time.Time{}); cerr != nil {
			return n, cerr
		}
	}
	return n, err
}
