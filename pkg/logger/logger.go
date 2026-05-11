package logger

import (
	"os"
	"time"

	"github.com/rs/zerolog"
)

func InitLogger(compName string) (zerolog.Logger, error) {
	zerolog.TimestampFunc = func() time.Time { return time.Now().UTC() }
	zerolog.DurationFieldUnit = time.Millisecond
	zerolog.DurationFieldInteger = true
	const consoleTimeFormat = "02 Jan 06 15:04 MST"

	cw := zerolog.ConsoleWriter{
		Out:        os.Stdout,
		TimeFormat: consoleTimeFormat,
	}

	baseLog := zerolog.New(cw).With().Timestamp().Logger()

	log := baseLog.With().Str("service", compName).Logger().Level(zerolog.InfoLevel)

	return log, nil
}
