FROM node:22-alpine
WORKDIR /app
COPY server.js .
# Railway volumes are mounted root-owned: the harness stays root to write /data.
# Fine for a short-lived capture tool; the real app will handle this properly.
EXPOSE 3000
CMD ["node", "server.js"]
