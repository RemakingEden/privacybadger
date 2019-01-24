/*
 * This file is part of Privacy Badger <https://www.eff.org/privacybadger>
 * Copyright (C) 2014 Electronic Frontier Foundation
 * Derived from ShareMeNot
 * Copyright (C) 2011-2014 University of Washington
 *
 * Privacy Badger is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * Privacy Badger is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Privacy Badger.  If not, see <http://www.gnu.org/licenses/>.
 */

/*
 * ShareMeNot is licensed under the MIT license:
 * http://www.opensource.org/licenses/mit-license.php
 *
 * Copyright (c) 2011-2014 University of Washington
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be included
 * in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 * OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 * IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 * CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/**
 * Widget data, read from file.
 */
let trackerInfo;

// cached chrome.i18n.getMessage() results
const TRANSLATIONS = [];


/**
 * Initializes the content script.
 */
function initialize() {
  // Get tracker info and check for initial blocks (that happened
  // before content script was attached)
  getTrackerData(function (trackers, trackerButtonsToReplace) {
    trackerInfo = trackers;
    replaceInitialTrackerButtonsHelper(trackerButtonsToReplace);
  });

  // Set up listener for blocks that happen after initial check
  chrome.runtime.onMessage.addListener(function(request/*, sender, sendResponse*/) {
    if (request.replaceWidget) {
      replaceSubsequentTrackerButtonsHelper(request.trackerDomain);
    }
  });
}

/**
 * Creates a replacement button element for the given tracker.
 *
 * @param {Tracker} tracker the Tracker object for the button
 *
 * @param {Element} trackerElem the tracking element that we are replacing
 *
 * @param {Function} callback called with the replacement button element for the tracker
 */
function createReplacementButtonImage(tracker, trackerElem, callback) {
  var buttonData = tracker.replacementButton;

  // already have replacement button image URI cached
  if (buttonData.buttonUrl) {
    return setTimeout(function () {
      _createReplacementButtonImageCallback(tracker, trackerElem, callback);
    }, 0);
  }

  if (buttonData.loading) {
    return setTimeout(function () {
      createReplacementButtonImage(tracker, trackerElem, callback);
    }, 10);
  }

  // don't have image data cached yet, get it from the background page
  buttonData.loading = true;
  chrome.runtime.sendMessage({
    getReplacementButton: buttonData.imagePath
  }, function (response) {
    buttonData.buttonUrl = response; // cache image data
    _createReplacementButtonImageCallback(tracker, trackerElem, callback);
  });
}

function _createReplacementButtonImageCallback(tracker, trackerElem, callback) {
  var buttonData = tracker.replacementButton;

  var button = document.createElement("img");

  var buttonUrl = buttonData.buttonUrl;
  var buttonType = buttonData.type;
  var details = buttonData.details;

  button.setAttribute("src", buttonUrl);

  button.setAttribute(
    "title",
    TRANSLATIONS.social_tooltip_pb_has_replaced.replace("XXX", tracker.name)
  );

  let styleAttrs = [
    "border: none",
    "cursor: pointer",
    "height: auto",
    "width: auto",
  ];
  button.setAttribute("style", styleAttrs.join(" !important;") + " !important");

  // normal button type; just open a new window when clicked
  if (buttonType === 0) {
    var popupUrl = details + encodeURIComponent(window.location.href);

    button.addEventListener("click", function() {
      window.open(popupUrl);
    });

  // in place button type; replace the existing button
  // with an iframe when clicked
  } else if (buttonType == 1) {
    var iframeUrl = details + encodeURIComponent(window.location.href);

    button.addEventListener("click", function() {
      replaceButtonWithIframeAndUnblockTracker(button, buttonData.unblockDomains, iframeUrl);
    }, { once: true });

  // in place button type; replace the existing button with code
  // specified in the Trackers file
  } else if (buttonType == 2) {
    button.addEventListener("click", function() {
      replaceButtonWithHtmlCodeAndUnblockTracker(button, buttonData.unblockDomains, details);
    }, { once: true });

  // in-place widget type:
  // reinitialize the widget by reinserting its element's HTML
  } else if (buttonType == 3) {
    let widget = createReplacementWidget(button, trackerElem, buttonData.unblockDomains);
    return callback(widget);
  }

  callback(button);
}


/**
 * Unblocks the given tracker and replaces the given button with an iframe
 * pointing to the given URL.
 *
 * @param {Element} button the DOM element of the button to replace
 * @param {Array} domains the button's domains
 * @param {String} iframeUrl the URL of the iframe to replace the button
 */
function replaceButtonWithIframeAndUnblockTracker(button, domains, iframeUrl) {
  unblockTracker(domains, function () {
    // check is needed as for an unknown reason this callback function is
    // executed for buttons that have already been removed; we are trying
    // to prevent replacing an already removed button
    if (button.parentNode !== null) {
      var iframe = document.createElement("iframe");

      iframe.setAttribute("src", iframeUrl);
      iframe.setAttribute("style", "border: none !important; height: 1.5em !important;");

      button.parentNode.replaceChild(iframe, button);
    }
  });
}

/**
 * Unblocks the given tracker and replaces the given button with the
 * HTML code defined in the provided Tracker object.
 *
 * @param {Element} button the DOM element of the button to replace
 * @param {Array} domains the button's domains
 * @param {String} html the HTML string that should replace the button
 */
function replaceButtonWithHtmlCodeAndUnblockTracker(button, domains, html) {
  unblockTracker(domains, function () {
    // check is needed as for an unknown reason this callback function is
    // executed for buttons that have already been removed; we are trying
    // to prevent replacing an already removed button
    if (button.parentNode !== null) {
      var codeContainer = document.createElement("div");
      codeContainer.innerHTML = html;

      button.parentNode.replaceChild(codeContainer, button);

      replaceScriptsRecurse(codeContainer);
    }
  });
}

/**
 * Unblocks the given tracker and replaces our replacement widget
 * with the original third-party widget element.
 *
 * The teardown to the initialization defined in createReplacementWidget().
 *
 * @param {HTMLElement} replacementWidget the DOM element of replacement widget
 * @param {Array} domains the widget's domains
 * @param {HTMLElement} widget the DOM element for the third-party widget
 * @param {HTMLElement} parentEl the parent DOM element
 */
function reinitializeWidgetAndUnblockTracker(replacementWidget, domains, widget, parentEl) {
  unblockTracker(domains, function () {
    parentEl.replaceChild(widget, replacementWidget);
  });
}

/**
 * Dumping scripts into innerHTML won't execute them, so replace them
 * with executable scripts.
 */
function replaceScriptsRecurse(node) {
  if (node.nodeName && node.nodeName.toLowerCase() == 'script' &&
      node.getAttribute && node.getAttribute("type") == "text/javascript") {
    var script = document.createElement("script");
    script.text = node.innerHTML;
    script.src = node.src;
    node.parentNode.replaceChild(script, node);
  } else {
    var i = 0;
    var children = node.childNodes;
    while (i < children.length) {
      replaceScriptsRecurse(children[i]);
      i++;
    }
  }
  return node;
}


/**
 * Replaces all tracker buttons on the current web page with the internal
 * replacement buttons, respecting the user's blocking settings.
 *
 * @param {Object} trackerButtonsToReplace a map of tracker names to boolean
 * values saying whether those trackers' buttons should be replaced
 */
function replaceInitialTrackerButtonsHelper(trackerButtonsToReplace) {
  trackerInfo.forEach(function(tracker) {
    var replaceTrackerButtons = trackerButtonsToReplace[tracker.name];
    if (replaceTrackerButtons) {
      replaceIndividualButton(tracker);
    }
  });
}

/**
 * Individually replaces tracker buttons blocked after initial check.
 */
function replaceSubsequentTrackerButtonsHelper(trackerDomain) {
  if (!trackerInfo) { return; }
  trackerInfo.forEach(function(tracker) {
    var replaceTrackerButtons = (tracker.domain == trackerDomain);
    if (replaceTrackerButtons) {
      replaceIndividualButton(tracker);
    }
  });
}

function createReplacementWidget(button, buttonToReplace, trackerDomains) {
  let widgetFrame = document.createElement('iframe');

  // widget replacement frame styles
  let styleAttrs = [
    "border: 1px solid #ec9329",
    "width:" + buttonToReplace.clientWidth + "px",
    "height:" + buttonToReplace.clientHeight + "px",
  ];
  widgetFrame.style = styleAttrs.join(" !important;") + " !important";

  let widgetDiv = document.createElement('div');

  // parent div styles
  styleAttrs = [
    "display: flex",
    "flex-direction: column",
    "align-items: center",
    "justify-content: center",
    "width: 100%",
    "height: 100%",
  ];
  widgetDiv.style = styleAttrs.join(" !important;") + " !important";

  // child div styles
  styleAttrs = [
    "display: flex",
    "align-items: center",
    "justify-content: center",
    "text-align: center",
    "margin: 10px",
    "width: 100%",
  ];

  let textDiv = document.createElement('div');
  textDiv.style = styleAttrs.join(" !important;") + " !important";
  textDiv.appendChild(document.createTextNode(button.title));
  widgetDiv.appendChild(textDiv);

  let buttonDiv = document.createElement('div');
  buttonDiv.style = styleAttrs.join(" !important;") + " !important";
  buttonDiv.appendChild(button);
  widgetDiv.appendChild(buttonDiv);

  let parentEl = buttonToReplace.parentNode;
  widgetFrame.addEventListener('load', function () {
    // click handler
    widgetFrame.contentDocument.querySelector('img').addEventListener("click", function () {
      reinitializeWidgetAndUnblockTracker(widgetFrame, trackerDomains, buttonToReplace, parentEl);
    }, { once: true });
  }, false);

  widgetFrame.srcdoc = '<html><head><style>html, body { height: 100%; overflow: hidden; }</style></head><body>' + widgetDiv.outerHTML + '</body></html>';

  return widgetFrame;
}

/**
 * Actually do the work of replacing the button.
 */
function replaceIndividualButton(tracker) {

  // makes a comma separated list of CSS selectors that specify
  // buttons for the current tracker; used for document.querySelectorAll
  var buttonSelectorsString = tracker.buttonSelectors.toString();
  var buttonsToReplace =
    document.querySelectorAll(buttonSelectorsString);

  buttonsToReplace.forEach(function (buttonToReplace) {
    createReplacementButtonImage(tracker, buttonToReplace, function (button) {
      buttonToReplace.parentNode.replaceChild(button, buttonToReplace);
    });
  });
}

/**
 * Gets data about which tracker buttons need to be replaced from the main
 * extension and passes it to the provided callback function.
 *
 * @param {Function} callback the function to call when the tracker data is
 *                            received; the arguments passed are the folder
 *                            containing the content script, the tracker
 *                            data, and a mapping of tracker names to
 *                            whether those tracker buttons need to be
 *                            replaced
 */
function getTrackerData(callback) {
  chrome.runtime.sendMessage({checkReplaceButton: true}, function(response) {
    if (response) {
      for (const key in response.translations) {
        TRANSLATIONS[key] = response.translations[key];
      }
      callback(response.trackers, response.trackerButtonsToReplace);
    }
  });
}

/**
 * Messages the background page to temporarily allow an array of domains.
 * Calls the provided callback function upon response.
 *
 * @param {Array} domains the domains to be temporarily allowed
 * @param {Function} callback the callback function
 */
function unblockTracker(domains, callback) {
  let request = {
    unblockWidget: true,
    domains: domains
  };
  chrome.runtime.sendMessage(request, callback);
}

// END FUNCTION DEFINITIONS ///////////////////////////////////////////////////

(function () {

// don't inject into non-HTML documents (such as XML documents)
// but do inject into XHTML documents
if (document instanceof HTMLDocument === false && (
  document instanceof XMLDocument === false ||
  document.createElement('div') instanceof HTMLDivElement === false
)) {
  return;
}

chrome.runtime.sendMessage({
  checkWidgetReplacementEnabled: true
}, function (checkWidgetReplacementEnabled) {
  if (!checkWidgetReplacementEnabled) {
    return;
  }
  initialize();
});

}());
