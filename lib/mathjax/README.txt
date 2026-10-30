MathJax 3.2.2 (https://www.mathjax.org/), Apache License 2.0 (see LICENSE in this folder).
Unchanged copies of es5/tex-svg.js and es5/input/tex/extensions/*.js from the npm package mathjax@3.2.2
(https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/). SiliCoDraw loads this copy first, so formulas can be typeset
without internet, and falls back to that CDN address when the folder is missing. Keep the version the same as the
CDN address in figure-editor.html (loadMathJax).
