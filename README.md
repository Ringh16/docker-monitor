# Docker Host Telemetry

**Monitoreo local de contenedores Docker en tiempo real, telemetría de recursos en vivo y control seguro de ciclo de vida diseñado para observabilidad sin tirones.**

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.12%2B-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![Docker](https://img.shields.io/badge/Docker-SDK_&_Socket-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docs.docker.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Licencia: MIT](https://img.shields.io/badge/Licencia-MIT-10B981?style=flat-square)](./LICENSE)

---

## Descripción General

**Docker Host Telemetry** elimina la fricción de alternar constantemente entre `docker ps`, `docker stats` y `docker logs` durante el desarrollo local y el diagnóstico del host. Combina un motor de telemetría asíncrono en **FastAPI** conectado directamente al socket local de Docker (`unix:///var/run/docker.sock` o *named pipe* `npipe:////./pipe/docker_engine` en Windows) con una consola operativa de alta precisión construida en **React + Tailwind CSS**.

En lugar de depender de sondeos pesados o plantillas administrativas genéricas, la plataforma transmite métricas de CPU, memoria RAM, PIDs y tráfico de red cada **2.0 segundos** mediante WebSockets nativos, renderizando gráficas SVG en vivo y medidores acelerados por GPU sin desplazamientos de diseño (*layout shift*).

---

## Características Principales

- **Telemetría en Tiempo Real vía WebSockets (`/ws/stats`)**: Recolección concurrente de métricas cada 2 segundos usando `asyncio.gather` y ejecución no bloqueante con `asyncio.to_thread` sobre `docker-py`.
- **Métricas Exactas Estilo Docker CLI**: Calcula deltas reales de uso de CPU (con soporte para `online_cpus`) y consumo de memoria cgroup v1/v2 descontando caché recuperable (`inactive_file` / `cache`).
- **Control Seguro de Ciclo de Vida**: Permite iniciar, detener, reiniciar, pausar y reanudar contenedores vía REST con validación estricta de transiciones de estado (`409 Conflict` ante acciones inválidas, `404` si no existe el contenedor, `503` si el daemon está apagado).
- **Resolución Resiliente de Imágenes y Metadatos**: Maneja correctamente contenedores detenidos cuya imagen original fue eliminada sin interrumpir el inventario del host.
- **Interfaz de Ingeniería UI/UX ("Oxide & Carbon")**:
  - Paleta oscura intencional (lienzo `#090A0C`, superficies `#111318`, bordes finos de `1px` en `#222631`) junto con `Plus Jakarta Sans` y `JetBrains Mono` (`tabular-nums`).
  - Microinteracciones aceleradas por hardware por debajo de 250ms (respuesta táctil `scale(0.97)`, barras GPU `scaleX` y panel inspector deslizable en `210ms`).
  - Atajos de teclado instantáneos (`/` para enfocar la búsqueda, `Escape` para limpiar filtros o cerrar el inspector).
  - Inspector de logs en vivo (`tail 120`) con copia al portapapeles en un clic y oscilograma dual SVG de los últimos 48 segundos.
- **Modo Host Simulado Integrado**: Respaldo en un clic (`?simulated=true`) para explorar el flujo WebSocket y todas las interacciones de la interfaz incluso cuando Docker Desktop está detenido.

---

## Arquitectura del Sistema

```text
┌───────────────────────────┐       HTTP /api/* & WS /ws/stats       ┌─────────────────────────────┐
│   React 19 + Vite UI      │ ◄────────────────────────────────────► │   Servidor ASGI FastAPI     │
│   (Tailwind CSS v4)       │        Proxy Vite (:5173 -> :8000)     │   (uvicorn + TelemetryLoop) │
└───────────────────────────┘                                        └──────────────┬──────────────┘
                                                                                    │
                                                          asyncio.to_thread() +     │ docker.from_env()
                                                          asyncio.gather()          ▼
                                                                     ┌─────────────────────────────┐
                                                                     │   Docker Engine Local       │
                                                                     │   (Unix Socket / Named Pipe)│
                                                                     └─────────────────────────────┘
```

1. **Plano de Inventario y Control (REST)**: Al iniciar y tras cada acción de control, `useDockerTelemetry` consulta `GET /api/health` y `GET /api/containers` para sincronizar metadatos, puertos expuestos y capacidad del host. Las acciones (`POST /api/containers/{id}/actions/{action}`) se validan contra `ALLOWED_TRANSITIONS` antes de invocar al SDK de Docker.
2. **Flujo de Telemetría (WebSocket)**: `TelemetryBroadcaster` gestiona los suscriptores activos en `/ws/stats`, entrega una instantánea inmediata al conectar y transmite tramas `stats_tick` concurrentes cada 2 segundos, con reconexión automática mediante *backoff* exponencial en el cliente.
3. **Inspector y Logs**: Al seleccionar cualquier fila o tarjeta de telemetría se abre `InspectorDrawer`, graficando una ventana móvil de 24 muestras (`48s`) junto con los registros de `GET /api/containers/{id}/logs`.

---

## Requisitos Previos

Asegúrate de tener instaladas las siguientes herramientas antes de ejecutar el proyecto:

- **Python** `3.12+`
- **Node.js** `20+` y **npm** `10+`
- **Docker Desktop** (Windows/macOS) o **Docker Engine** (Linux) en ejecución con acceso al socket local

---

## Guía de Instalación y Configuración

### 1. Clonar el Repositorio

```bash
git clone https://github.com/Ringh16/docker-monitor.git
cd docker-monitor
```

### 2. Configurar el Backend (FastAPI)

Crea un entorno virtual aislado e instala las dependencias de Python:

```bash
cd backend
python -m venv .venv
```

Activa el entorno virtual:

- **Windows (PowerShell):**
  ```powershell
  .venv\Scripts\Activate.ps1
  ```
- **Linux / macOS:**
  ```bash
  source .venv/bin/activate
  ```

Instala las dependencias:

```bash
pip install -r requirements.txt
```

### 3. Configurar el Frontend (React + Vite)

En otra terminal, instala los paquetes del cliente web:

```bash
cd frontend
npm install
```

---

## Uso y Ejecución

### Iniciar el Servidor Backend

Desde `backend/` (con el entorno virtual activado):

```bash
uvicorn app.main:app --reload --port 8000
```

Endpoints disponibles en la API:

| Método / Protocolo | Endpoint | Descripción |
| --- | --- | --- |
| `GET` | `/api/health` | Conectividad con el daemon Docker, versión del motor y capacidad CPU/RAM del host |
| `GET` | `/api/containers` | Lista todos los contenedores locales (`running`, `paused`, `exited`) y sus puertos |
| `POST` | `/api/containers/{id}/actions/{action}` | Ejecuta `start`, `stop`, `restart`, `pause` o `unpause` de forma segura |
| `GET` | `/api/containers/{id}/logs?tail=120` | Obtiene las líneas recientes de `stdout`/`stderr` con marcas de tiempo |
| `WS` | `/ws/stats` | Stream en tiempo real cada 2.0s (`cpu_percent`, `memory_usage_mb`, `pids`, `net_rx/tx`) |

### Iniciar el Servidor de Desarrollo Frontend

Desde `frontend/`:

```bash
npm run dev
```

Abre **[http://localhost:5173](http://localhost:5173)** en tu navegador. Vite redirige automáticamente las peticiones `/api` y `/ws` hacia `http://127.0.0.1:8000`.

> **Consejo:** Si Docker Desktop está apagado, haz clic en **"Activar Host Simulado en Vivo"** en el banner de diagnóstico (o alterna **Live Socket / Modo Simulado** en la cabecera) para probar el stream de telemetría con cargas simuladas.

---

## Estructura del Proyecto

```text
docker-monitor/
├── .gitignore
├── LICENSE
├── README.md
├── backend/
│   ├── requirements.txt
│   └── app/
│       ├── __init__.py
│       ├── config.py                # Pydantic Settings (intervalo de sondeo, CORS, flags)
│       ├── docker_service.py        # Fachada asíncrona Docker SDK, cálculo de stats y validaciones
│       ├── main.py                  # Entrypoint FastAPI, lifespan y rutas REST/WS
│       ├── schemas.py               # Modelos Pydantic v2 para respuestas y WebSocket
│       └── ws_manager.py            # Pool de conexiones /ws/stats y bucle cada 2.0s
└── frontend/
    ├── index.html                   # Fuentes (Plus Jakarta Sans + JetBrains Mono)
    ├── package.json
    ├── vite.config.js               # Proxy dev (/api, /ws) y plugin Tailwind v4
    └── src/
        ├── App.jsx                  # Layout principal, filtros, banner diagnóstico y toasts
        ├── index.css                # Tokens Oxide & Carbon, cubic-bezier y GPU meters
        ├── main.jsx
        ├── hooks/
        │   └── useDockerTelemetry.js # Hook unificado REST + WebSocket con reconexión
        └── components/
            ├── ContainerRow.jsx     # Fila de matriz de contenedores y controles seguros
            ├── HostHeader.jsx       # Barra sticky del host y filtro rápido con '/'
            ├── InspectorDrawer.jsx  # Panel deslizable (<210ms) con oscilograma y logs
            └── TelemetryRibbon.jsx  # Trazas SVG en vivo de los 4 contenedores más activos
```

---

## Contribución y Licencia

Las contribuciones, reportes de errores y sugerencias de mejora son bienvenidas:

1. Haz un *fork* del repositorio.
2. Crea tu rama de funcionalidad (`git checkout -b feat/nueva-funcionalidad`).
3. Confirma tus cambios con mensajes claros (`git commit -m "feat: agregar filtro de contenedores"`).
4. Sube tu rama (`git push origin feat/nueva-funcionalidad`) y abre un *Pull Request*.

Distribuido bajo la **Licencia MIT**. Consulta el archivo [LICENSE](./LICENSE) para más detalles.
