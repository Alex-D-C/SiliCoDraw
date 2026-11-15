MathJax 3.2.2 (https://www.mathjax.org/), Apache License 2.0 (see LICENSE in this folder).
Unchanged copies of es5/tex-svg.js and es5/input/tex/extensions/*.js from the npm package mathjax@3.2.2
(https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/). SiliCoDraw loads this copy first, so formulas can be typeset
without internet, and falls back to that CDN address when the folder is missing. Keep the version the same as the
CDN address in figure-editor.html (loadMathJax).
The CDN copy is pinned by the SHA-384 of this same tex-svg.js (MJ_SRI in figure-editor.html):
sha384-KKWa9jJ1MZvssLeOoXG6FiOAZfAgmzsIIfw8BXwI9+kYm0lPCbC6yTQPBC00F1/L
(the TeX extensions MathJax loads from the CDN later, such as mhchem, cannot be pinned: MathJax adds those script tags itself).
