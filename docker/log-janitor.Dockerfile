FROM alpine:3.20.6@sha256:de4fe7064d8f98419ea6b49190df1abbf43450c1702eeb864fe9ced453c1cc5f

COPY docker/log-janitor.sh /janitor.sh

CMD ["sh", "/janitor.sh"]
