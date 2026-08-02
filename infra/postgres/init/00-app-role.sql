-- Runs once on first container init (official postgres image executes files in
-- /docker-entrypoint-initdb.d against POSTGRES_DB).
--
-- Creates the RESTRICTED application role. It is deliberately NOSUPERUSER and
-- NOBYPASSRLS so PostgreSQL Row-Level Security is enforced for the API at all
-- times. Table/sequence privileges are granted by the RLS Alembic migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'casa_app') THEN
    CREATE ROLE casa_app LOGIN PASSWORD 'casa_app_pwd'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE casa_harmony TO casa_app;
GRANT USAGE ON SCHEMA public TO casa_app;
