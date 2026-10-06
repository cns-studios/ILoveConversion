FROM postgres:16-alpine

COPY db/init.sql /docker-entrypoint-initdb.d/01-init.sql
