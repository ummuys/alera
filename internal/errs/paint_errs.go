package errs

import "errors"

var (
	ErrRoomDoNotExists = errors.New("room doesn't exists")
	ErrRoomIsFull      = errors.New("room is full")
)
