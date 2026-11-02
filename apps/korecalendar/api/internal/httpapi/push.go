package httpapi

import (
	"errors"
	"net/http"

	"github.com/qarasky/korecalendar/api/internal/push"
)

func (s *server) handlePushKey(w http.ResponseWriter, r *http.Request) {
	key, err := push.PublicKey(r.Context(), s.db)
	if err != nil {
		errJSON(w, http.StatusInternalServerError, "internal", "could not read the push key")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"publicKey": key})
}

func (s *server) handleSubscribe(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if !decode(w, r, &in) {
		return
	}
	id, created, err := push.Subscribe(r.Context(), s.db, actor(r).UserID, in.Endpoint, in.Keys.P256dh, in.Keys.Auth)
	if errors.Is(err, push.ErrInvalid) {
		errJSON(w, http.StatusUnprocessableEntity, "validation_error", err.Error())
		return
	}
	if err != nil {
		errJSON(w, http.StatusInternalServerError, "internal", "could not save the subscription")
		return
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(w, status, map[string]string{"id": id})
}

func (s *server) handleUnsubscribe(w http.ResponseWriter, r *http.Request) {
	err := push.Unsubscribe(r.Context(), s.db, actor(r).UserID, r.PathValue("id"))
	if errors.Is(err, push.ErrNotFound) {
		errJSON(w, http.StatusNotFound, "not_found", "subscription not found")
		return
	}
	if err != nil {
		errJSON(w, http.StatusInternalServerError, "internal", "could not remove the subscription")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
