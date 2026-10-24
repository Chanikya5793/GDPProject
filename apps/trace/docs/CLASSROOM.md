# Presenting TRACE

1. Open the site on **Planner pipeline** and press **Play**. The camera follows the sentence
   through the eight steps; the guide on the left says what each frame does. Playback stops
   after **Decide**, because the default request matches two reminders with the same title.
2. Good places to pause (<kbd>Space</kbd>) and step frame by frame (<kbd>→</kbd>):
   - **Tokenize**: the character span in the input lights up blue, the regex alternative that
     matched lights up, and the token row fills in amber.
   - **TF–IDF** and **Cosine**: every weight and product is on the map; A and B score exactly
     the same, which is why the tie exists.
   - **Decide**: each rule's test with the values that made it true or false.
3. At **Decide**, choose **B**, then **Review the change** and **Confirm**. B moves to Oct 20,
   11:00 AM and becomes revision 2; A is untouched. **Data** lists all records.
4. Use the request chip at the top to try the examples: **An impossible time** and **Every
   Friday… until when?** stop at Decide with a question; **Four Fridays** expands into four
   dated reminders before confirmation.
5. Switch to **Transformer block**. Follow BPE, the embedding and position formulas, Q · K (the
   query row and key row light up as each score is written), the causal mask and softmax, the
   weighted sum, add & norm, the feed-forward layer and the vocabulary softmax. At **Decode**,
   **Append and run again** adds the predicted token and reruns every step on the shifted window.
6. Toggle **2D / 3D** at any point; both show the same frame. **Overview** (<kbd>O</kbd>) zooms out
   to the whole track. Click any number to jump to the frame that computed it.
7. **Data → Run the checks** runs eight assertions against fresh copies of the engine.
   **Download trace.json** saves every intermediate value of the current run.

Records are fictional and reset on reload. The transformer's weights are untrained: its output
shows the arithmetic of a transformer block, not language ability.
