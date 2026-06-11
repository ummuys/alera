package main

import (
	"context"
	"log"
	"os/signal"
	"syscall"

	"github.com/ummuys/alera/internal/paint"
	"github.com/ummuys/alera/internal/web"
	"github.com/ummuys/alera/pkg/logger"
)

func main() {

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	logs, err := logger.InitLogger("main")
	if err != nil {
		log.Fatal(err)
	}

	pc := paint.NewPaintHub(ctx, logs)
	web.RunServer(ctx, pc, logs)
}
