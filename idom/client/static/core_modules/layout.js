import * as react from "react";
import * as reactDOM from "react-dom";
import htm from "htm";
import * as jsonpatch from "fast-json-patch";

import serializeEvent from "./event-to-object";

const html = htm.bind(react.createElement);
const alreadyImported = {};

export function mountLayoutWithWebSocket(mountElement, endpoint) {
  if (endpoint.startsWith(".") || endpoint.startsWith("/")) {
    let loc = window.location;
    let protocol;
    if (loc.protocol === "https:") {
      protocol = "wss:";
    } else {
      protocol = "ws:";
    }
    let new_uri = protocol + "//" + loc.host;
    if (endpoint.startsWith(".")) {
      new_url += loc.pathname + "/";
    }
    endpoint = new_uri + endpoint;
  }

  const ws = new WebSocket(endpoint);

  function registerUpdateCallback(update) {
    ws.onmessage = (event) => {
      const [pathPrefix, patch] = JSON.parse(event.data);
      update(pathPrefix, patch);
    };
  }

  function sendCallback(event) {
    ws.send(
      JSON.stringify({
        header: {},
        body: { event: event },
      })
    );
  }

  const cmpt = html`<${Layout}
    registerUpdateCallback=${registerUpdateCallback}
    sendCallback=${sendCallback}
  />`;

  return reactDOM.render(cmpt, mountElement);
}

export default function Layout({ registerUpdateCallback, sendCallback }) {
  const [model, setModel] = react.useState({});

  react.useEffect(() => {
    registerUpdateCallback((pathPrefix, patch) => {
      setModel(
        jsonpatch.applyPatch(
          model,
          patch.map((op) => {
            op.path = pathPrefix + op.path;
            return op;
          }),
          undefined,
          false
        ).newDocument
      );
    });
  }, [model]);

  if (model.tagName) {
    return html`<${Element} sendEvent=${sendCallback} model=${model} />`;
  } else {
    return html`<div />`;
  }
}

function Element({ sendEvent, model, key }) {
  if (model.importSource) {
    return html`<${LazyElement} sendEvent=${sendEvent} model=${model} />`;
  } else {
    const children = elementChildren(sendEvent, model);
    const attributes = elementAttributes(sendEvent, model);
    if (model.children && model.children.length) {
      return html`<${model.tagName} key=${index} ...${attributes}
        >${children}<//
      >`;
    } else {
      return html`<${model.tagName} key=${index} ...${attributes} />`;
    }
  }
}

function LazyElement({ sendEvent, model, key }) {
  const module = useLazyModule(model.importSource.source);
  if (module) {
    const cmpt = getPathProperty(module, model.tagName);
    const children = elementChildren(sendEvent, model);
    const attributes = elementAttributes(sendEvent, model);
    return html`<${cmpt} ...${attributes}>${children}<//>`;
  } else {
    const fallbackModel = model.importSource.fallback;
    if (typeof model == "object") {
      return html`<${Element}
        key=${index}
        model=${fallbackModel}
        sendEvent=${sendEvent}
      /> `;
    } else {
      return html`<div key=${index}>${fallbackModel}</div>`;
    }
  }
}

function elementChildren(sendEvent, model) {
  if (!model.children) {
    return [];
  } else {
    return model.children.map((child, index) => {
      switch (typeof child) {
        case "object":
          return html`<${Element}
            key=${index}
            model=${child}
            sendEvent=${sendEvent}
          /> `;
        case "string":
          return child;
      }
    });
  }
}

function elementAttributes(sendEvent, model) {
  const attributes = Object.assign({}, model.attributes);

  if (model.eventHandlers) {
    Object.keys(model.eventHandlers).forEach((eventName) => {
      const eventSpec = model.eventHandlers[eventName];
      attributes[eventName] = eventHandler(sendEvent, eventSpec);
    });
  }

  return attributes;
}

function eventHandler(sendEvent, eventSpec) {
  return function () {
    const data = Array.from(arguments).map((value) => {
      if (typeof value === "object" && value.nativeEvent) {
        if (eventSpec["preventDefault"]) {
          value.preventDefault();
        }
        if (eventSpec["stopPropagation"]) {
          value.stopPropagation();
        }
        return serializeEvent(value);
      } else {
        return value;
      }
    });
    const sentEvent = new Promise((resolve, reject) => {
      const msg = {
        data: data,
        target: eventSpec["target"],
      };
      sendEvent(msg);
      resolve(msg);
    });
  };
}

function useLazyModule(source) {
  const [module, setModule] = react.useState(alreadyImported[source]);
  if (!module) {
    dynamicImport(source).then(setModule);
  }
  return module;
}

function dynamicImport(source) {
  return eval(`import('${source}')`).then(
    (pkg) => (pkg.default ? pkg.default : pkg),
    (error) => {
      if (!error.stack) {
        throw error;
      } else {
        console.log(error);
        return {
          default: function Catch() {
            return html`
              <pre>
                  <h1>Error</h1>
                  <code>${[error.stack, error.message]}</code>
                </pre
              >
            `;
          },
        };
      }
    }
  );
}

function getPathProperty(obj, prop) {
  // properties may be dot seperated strings
  const path = prop.split(".");
  const firstProp = path.shift();
  let value = obj[firstProp];
  for (let i = 0; i < path.length; i++) {
    value = value[path[i]];
  }
  return value;
}
