package errs

import "errors"

var (
	ErrEmptyRoomID    = errors.New("empty room_id")
	ErrInvalidRequest = errors.New("invalid request")
	ErrInvalidMethod  = errors.New("invalid method")
	ErrInternal       = errors.New("something wrong with server, try again later")
)
