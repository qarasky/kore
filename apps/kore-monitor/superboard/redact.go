package main

import (
	"net/url"
	"strings"
)

// redactedError is an error whose text has the push token removed. The
// original stays reachable through Unwrap for errors.Is/As, but nothing that
// prints the error (the journal, agent.lastError on the board) sees the token.
type redactedError struct {
	msg string
	err error
}

func (e *redactedError) Error() string { return e.msg }
func (e *redactedError) Unwrap() error { return e.err }

// redactToken removes the push token from an error's text. Go's HTTP client
// errors (*url.Error) include the full request URL, and the token is part of
// the push path and of the update query string.
func redactToken(err error, token string) error {
	if err == nil || token == "" {
		return err
	}
	msg := err.Error()
	for _, form := range []string{url.QueryEscape(token), url.PathEscape(token), token} {
		msg = strings.ReplaceAll(msg, form, "<token>")
	}
	if msg == err.Error() {
		return err
	}
	return &redactedError{msg: msg, err: err}
}
