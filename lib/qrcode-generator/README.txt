qrcode-generator 1.4.4 by Kazuhiko Arase (https://github.com/kazuhikoarase/qrcode-generator), MIT License (see LICENSE in this folder).
qrcode.min.js is an unchanged copy of https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js
(SHA-512 as cdnjs publishes it: ZDSPMa/JM1D+7kdg2x3BsruQ6T/JpJo3jWDWkCZsP+5yVyp1KfESqLI+7RqB5k24F7p2cV7i2YHh/890y6P6Sw==).
SiliCoDraw loads this copy first, so QR codes are made without internet, and falls back to that CDN address when the folder
is missing, pinned by the SHA-384 of this same file (LIB_QR in figure-editor.html):
sha384-mZT2gIty7ZDdOGkxfP6joZcYdMW1Jvj9dRlfpTmaJAKKXTqzygtB22k7FLe+KZC1
A new version: replace the file, and the address and the hash in LIB_QR (the browser test "libraries" checks that they agree).
