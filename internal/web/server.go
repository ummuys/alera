package web

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/ummuys/alera/internal/paint"
)

// Функция для запуска сервера, пока передается один интерфейс с аналогом paint
func RunServer(ctx context.Context, pc paint.PaintHub, logs zerolog.Logger) {

	mux := http.NewServeMux()
	frontendPath := resolveFrontendPath()

	sCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	// Выдаем статические файлы, пока не используем Nginx.
	mux.Handle("/", http.FileServer(http.Dir(frontendPath)))
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		paintWSHandle(w, r, pc)
	})

	server := http.Server{
		Addr:    "0.0.0.0:8089",
		Handler: mux,
	}

	logs.Info().Str("addr", server.Addr).Str("frontend", frontendPath).Msg("start server")

	var wg sync.WaitGroup
	wg.Go(func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logs.Error().Err(err).Msg("server stopped with error")
			cancel()
		}
	})

	<-sCtx.Done()

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		logs.Error().Err(err).Msg("server shutdown failed")
		return
	}

	wg.Wait()
	logs.Info().Msg("server stopped")
}

func resolveFrontendPath() string {
	candidates := []string{
		"frontend",
		filepath.Join("..", "frontend"),
		filepath.Join("..", "..", "frontend"),
	}

	for _, candidate := range candidates {
		indexPath := filepath.Join(candidate, "index.html")
		if info, err := os.Stat(indexPath); err == nil && !info.IsDir() {
			return candidate
		}
	}

	return "frontend"
}
