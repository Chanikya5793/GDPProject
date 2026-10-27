import "./planner.css";
import tokenize from "./tokenize.jsx";
import input from "./input.jsx";
import extract from "./extract.jsx";
import terms from "./terms.jsx";
import tfidf from "./tfidf.jsx";
import cosine from "./cosine.jsx";
import decide from "./decide.jsx";
import apply from "./apply.jsx";

// In pipeline order.
export default [input, tokenize, extract, terms, tfidf, cosine, decide, apply];
