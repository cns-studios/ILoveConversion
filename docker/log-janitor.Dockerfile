FROM alpine:3.20

COPY docker/log-janitor.sh /janitor.sh

CMD ["sh", "/janitor.sh"]
