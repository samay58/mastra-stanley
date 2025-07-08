# PostgreSQL + pgvector Setup Guide

Complete guide for setting up PostgreSQL with the pgvector extension for the IPO S-1 Agent project.

## Overview

The IPO S-1 Agent requires PostgreSQL with the pgvector extension to store and query vector embeddings. This guide provides multiple installation methods for different platforms.

## Prerequisites

- PostgreSQL 15+ (pgvector requires PostgreSQL 13+ but 15+ recommended)
- Administrative access to install extensions
- At least 1GB free disk space
- OpenAI API key (for embedding generation)

## Quick Start (Recommended)

### Option 1: Docker (Easiest)

Use the pre-built Docker image with PostgreSQL + pgvector:

```bash
# Start PostgreSQL with pgvector
docker run -d \
  --name ipo-agent-postgres \
  -e POSTGRES_USER=ipo_user \
  -e POSTGRES_PASSWORD=secure_password \
  -e POSTGRES_DB=ipo_agent \
  -p 5432:5432 \
  ankane/pgvector

# Wait a few seconds for startup, then test connection
docker exec -it ipo-agent-postgres psql -U ipo_user -d ipo_agent -c "SELECT version();"
```

**Connection String for .env:**
```
POSTGRES_CONNECTION_STRING=postgresql://ipo_user:secure_password@localhost:5432/ipo_agent
```

### Option 2: Local Installation

Choose your platform:

<details>
<summary><strong>🍎 macOS Installation</strong></summary>

#### Method A: Homebrew (Recommended)
```bash
# Install PostgreSQL 17 (latest supported)
brew install postgresql@17
brew link --overwrite postgresql@17

# Install pgvector
brew install pgvector

# Start PostgreSQL service
brew services start postgresql@17

# Create database and user
createdb ipo_agent
psql ipo_agent -c "CREATE USER ipo_user WITH PASSWORD 'secure_password';"
psql ipo_agent -c "GRANT ALL PRIVILEGES ON DATABASE ipo_agent TO ipo_user;"
psql ipo_agent -c "CREATE EXTENSION vector;"
```

#### Method B: Postgres.app
1. Download [Postgres.app](https://postgresapp.com/)
2. Install and start Postgres.app
3. Open terminal and install pgvector:
   ```bash
   # Compile pgvector from source
   cd /tmp
   git clone https://github.com/pgvector/pgvector.git
   cd pgvector
   make
   sudo make install
   ```
4. Create database:
   ```bash
   psql -c "CREATE DATABASE ipo_agent;"
   psql ipo_agent -c "CREATE EXTENSION vector;"
   ```

**Connection String:**
```
POSTGRES_CONNECTION_STRING=postgresql://username@localhost:5432/ipo_agent
```

</details>

<details>
<summary><strong>🐧 Linux Installation</strong></summary>

#### Ubuntu/Debian
```bash
# Add PostgreSQL APT repository
sudo apt update
sudo apt install -y wget ca-certificates
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
echo "deb http://apt.postgresql.org/pub/repos/apt/ $(lsb_release -cs)-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list

# Install PostgreSQL and pgvector
sudo apt update
sudo apt install -y postgresql-17 postgresql-17-pgvector

# Start PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres createdb ipo_agent
sudo -u postgres psql -c "CREATE USER ipo_user WITH PASSWORD 'secure_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ipo_agent TO ipo_user;"
sudo -u postgres psql ipo_agent -c "CREATE EXTENSION vector;"
```

#### RHEL/CentOS/Fedora
```bash
# Install PostgreSQL repository
sudo dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-9-x86_64/pgdg-redhat-repo-latest.noarch.rpm

# Install PostgreSQL and pgvector
sudo dnf install -y postgresql17-server postgresql17 pgvector_17

# Initialize database
sudo /usr/pgsql-17/bin/postgresql-17-setup initdb
sudo systemctl start postgresql-17
sudo systemctl enable postgresql-17

# Create database and user
sudo -u postgres createdb ipo_agent
sudo -u postgres psql -c "CREATE USER ipo_user WITH PASSWORD 'secure_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ipo_agent TO ipo_user;"
sudo -u postgres psql ipo_agent -c "CREATE EXTENSION vector;"
```

**Connection String:**
```
POSTGRES_CONNECTION_STRING=postgresql://ipo_user:secure_password@localhost:5432/ipo_agent
```

</details>

<details>
<summary><strong>🪟 Windows Installation</strong></summary>

#### Method A: Official PostgreSQL Installer + Source Compilation
1. Download and install [PostgreSQL for Windows](https://www.postgresql.org/download/windows/)
2. Install [Visual Studio with C++ build tools](https://visualstudio.microsoft.com/downloads/)
3. Compile pgvector:
   ```cmd
   # Open Command Prompt as Administrator
   cd C:\temp
   git clone https://github.com/pgvector/pgvector.git
   cd pgvector
   
   # Set PostgreSQL path (adjust version as needed)
   set PATH=C:\Program Files\PostgreSQL\17\bin;%PATH%
   
   # Compile and install
   nmake /F Makefile.win
   nmake /F Makefile.win install
   ```

#### Method B: WSL2 + Linux Installation
1. Install [WSL2](https://docs.microsoft.com/en-us/windows/wsl/install)
2. Follow the Linux installation steps above
3. Access from Windows using localhost

**Connection String:**
```
POSTGRES_CONNECTION_STRING=postgresql://postgres:your_password@localhost:5432/ipo_agent
```

</details>

## Cloud Options

### AWS RDS
AWS RDS supports pgvector on PostgreSQL 15.2+:

1. Create RDS PostgreSQL instance (15.2 or higher)
2. Connect to your instance
3. Enable extension:
   ```sql
   CREATE EXTENSION vector;
   ```

### Managed Services
- **Timescale Cloud**: Includes pgvector pre-installed
- **Supabase**: Supports pgvector extension
- **Neon**: PostgreSQL with pgvector support
- **Railway**: One-click PostgreSQL + pgvector deployment

## Verification Steps

After installation, verify everything works:

### 1. Test Connection
```bash
# Test basic connection (replace with your connection details)
psql postgresql://ipo_user:secure_password@localhost:5432/ipo_agent -c "SELECT version();"
```

### 2. Verify pgvector Extension
```sql
-- Connect to your database
psql postgresql://ipo_user:secure_password@localhost:5432/ipo_agent

-- Check if vector extension is available
SELECT * FROM pg_extension WHERE extname = 'vector';

-- Test vector functionality
CREATE TABLE test_vectors (id serial, embedding vector(3));
INSERT INTO test_vectors (embedding) VALUES ('[1,2,3]'), ('[4,5,6]');
SELECT * FROM test_vectors ORDER BY embedding <-> '[2,2,2]' LIMIT 1;

-- Clean up test
DROP TABLE test_vectors;
```

Expected output should show the nearest vector.

### 3. Test from IPO Agent
```bash
# In your ipo-agent directory
cd /path/to/ipo-agent

# Create .env file with your connection string
echo "POSTGRES_CONNECTION_STRING=postgresql://ipo_user:secure_password@localhost:5432/ipo_agent" >> .env
echo "OPENAI_API_KEY=your_openai_api_key" >> .env

# Test the embedding generator (dry run)
npm run embed
```

## Configuration for IPO Agent

### 1. Environment Variables
Create or update your `.env` file:

```bash
# OpenAI API key for embeddings
OPENAI_API_KEY=your_openai_api_key_here

# PostgreSQL connection string
POSTGRES_CONNECTION_STRING=postgresql://ipo_user:secure_password@localhost:5432/ipo_agent

# Optional: Mastra configuration
MASTRA_LOG_LEVEL=info
```

### 2. Database Schema
The IPO agent will automatically create the necessary tables when you run:

```bash
npm run embed
```

This creates:
- Vector index for embeddings (1536 dimensions)
- Metadata storage for chunk information
- Proper indexing for fast similarity search

## Usage Commands

Once setup is complete:

```bash
# Generate embeddings for all 575 S-1 chunks
npm run embed

# Test queries
npm run query "What is Figma's IPO price range?"

# Complex queries with workflow
npm run query "What are the main risk factors?" --workflow

# Start Mastra dev server
npx mastra dev
```

## Troubleshooting

### Common Issues

#### Connection Refused
```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql  # Linux
brew services list | grep postgresql  # macOS

# Check port and host
netstat -an | grep 5432
```

#### Permission Denied
```sql
-- Grant proper permissions
GRANT ALL PRIVILEGES ON DATABASE ipo_agent TO ipo_user;
GRANT ALL PRIVILEGES ON SCHEMA public TO ipo_user;
```

#### Extension Not Found
```bash
# Reinstall pgvector
# macOS:
brew reinstall pgvector

# Ubuntu:
sudo apt install --reinstall postgresql-17-pgvector
```

#### Out of Memory
```sql
-- Increase shared_preload_libraries in postgresql.conf
shared_preload_libraries = 'vector'

-- Restart PostgreSQL after changing config
sudo systemctl restart postgresql
```

### Performance Tuning

For better performance with large datasets:

```sql
-- Adjust memory settings in postgresql.conf
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 64MB

-- Create index for faster searches (done automatically by IPO agent)
CREATE INDEX ON embeddings USING ivfflat (embedding vector_cosine_ops);
```

## Security Considerations

### Production Deployment
- Use strong passwords
- Enable SSL/TLS connections
- Restrict network access
- Regular backups
- Update PostgreSQL and pgvector regularly

### Connection String for Production
```bash
# Use SSL and restrict access
POSTGRES_CONNECTION_STRING=postgresql://user:password@host:5432/database?sslmode=require
```

## Support Resources

- [pgvector GitHub Repository](https://github.com/pgvector/pgvector)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Mastra Framework Docs](https://mastra.ai/docs)
- [Project README](./README.md)

---

**Next Steps**: After successful setup, run `npm run embed` to generate embeddings for the S-1 document chunks.