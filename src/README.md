## Running the Project with Docker

This project is containerized using Docker and Docker Compose for easy setup and deployment. Below are the instructions and requirements specific to this project:

### Requirements
- **Node.js version:** 20 (as specified in the Dockerfile: `node:20-alpine`)
- **No external services** (e.g., databases) are required by default, based on the current project structure and Docker configuration.

### Environment Variables
- The Docker Compose file includes a commented `env_file: ./.env` line. If your application requires environment variables, create a `.env` file in the project root and uncomment this line in `docker-compose.yml`.
- No specific environment variables are required by default, but you can override `NODE_ENV` (defaults to `production`).

### Build and Run Instructions
1. **Build and start the application:**
   ```sh
   docker compose up --build
   ```
   This will build the Docker image and start the service defined as `js-app`.

2. **Stopping the application:**
   ```sh
   docker compose down
   ```

### Ports
- The application exposes **port 3000** by default. The service is accessible at `http://localhost:3000` on your host machine.

### Special Configuration
- The Dockerfile is set up to run the application as a non-root user for improved security.
- The `.env` file and any secrets should **not** be included in the Docker image (ensure they are listed in `.dockerignore`).
- If you add external services (like a database), update the `docker-compose.yml` accordingly (see commented sections in the file).

---

*Update this section if you add new services, environment variables, or change the exposed ports.*
