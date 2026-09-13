FROM node:20-alpine
# Poppler (pdftotext/pdftoppm rasterization) — tesseract.js fetches lang data via CDN, no OS packs needed
# vips for sharp
RUN apk add --no-cache poppler-utils vips-dev
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 4000
CMD ["node", "dist/index.js"]
