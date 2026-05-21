package web

import (
	"net/http"

	"github.com/gorilla/websocket"
	"github.com/ummuys/alera/internal/paint"
)

var upgrade = websocket.Upgrader{
	// Здесь мы проверяем какой клиент к нам подключается, пока даем доступ для всех
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// для request нужен указатель, так как это структура + тяжелая структура
// rw - это интерфейс, он не передается по указателю
func paintWSHandle(w http.ResponseWriter, r *http.Request, pc paint.PaintConn) {

	if http.MethodGet != r.Method {
		http.Error(w, "bad method", http.StatusMethodNotAllowed)
		return
	}

	// Пытаемся сделать upgrade
	conn, err := upgrade.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	pc.Add(conn)
}
