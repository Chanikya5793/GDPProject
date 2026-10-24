import "./transformer.css";
import bpe from "./bpe.jsx";
import embedding from "./embedding.jsx";
import position from "./position.jsx";
import scores from "./scores.jsx";
import attention from "./attention.jsx";
import output from "./weighted.jsx";
import residual from "./addnorm.jsx";
import feedforward from "./ffn.jsx";
import logits from "./logits.jsx";
import decode from "./decode.jsx";

export default [bpe, embedding, position, scores, attention, output, residual, feedforward, logits, decode];
