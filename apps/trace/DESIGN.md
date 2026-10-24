# Design notes

**Audience.** Students and instructors who know basic programming and want to see what an NLP
algorithm actually does to a sentence, number by number.

**Principle.** Every value on screen is computed by the engine for the current request. Layout,
camera and colors are presentation; tokens, offsets, scores, matrices and decisions are real.
When the code is a toy (fixed weights, a 60-merge tokenizer, a bounded grammar), the step says
so once, in its limit line.

**One map per track.** Each step is a column of data blocks; columns run left to right and
arrows connect a step's output to the next step's input. The whole computation is one place you
can pan around, so a value can always be traced back to where it came from. 2D and 3D draw the
same blocks with the same painter (`src/map/paint.js`): 2D on a canvas, 3D as textured plates.

**Frames drive everything.** A step module turns its algorithm into frames. Each frame has one
plain sentence with the real numbers, the pseudocode line, the variables, and a map state: which
cells are read, which are written, which are done. The renderers only draw that state, so the
narration, the code highlight and the picture never disagree.

**Calm motion.** The camera eases toward each frame and holds still while a whole step fits on
screen at a readable size; it only pans for steps too large to fit. Highlights fade in, the
amber frame glides from the last result to the next, and one dot travels along each read → write
line. No bloom, grain, orbits or floating objects. Reduced-motion preferences make the camera cut
and drop the travelling dots.

**Detail on demand.** The guide shows the current frame's arithmetic; hovering any cell shows its
full value; **Tables** opens the step as tables; **Real source** shows the engine function.

**Type and color.** Space Grotesk for headings, Manrope for text, the system monospace for code
and numbers. Body text 15–16px, nothing interactive under 12px. Blue means read, amber means
written, dashed means not computed yet. Positive numbers are teal, negative coral, probabilities
violet; the step accent colors the guide and timeline only.
