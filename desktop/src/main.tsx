import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { ScrollbarActivity } from "./components/ScrollbarActivity";
import "./cloud-globals.css";
import "../vendor/shared-ui/src/styles/shared-ui.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ScrollbarActivity />
    <App />
  </React.StrictMode>,
);
