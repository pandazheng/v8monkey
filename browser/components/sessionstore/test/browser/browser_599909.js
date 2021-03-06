/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is sessionstore test code.
 *
 * The Initial Developer of the Original Code is
 * Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 * Paul O’Shannessy <paul@oshannessy.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const TAB_STATE_NEEDS_RESTORE = 1;
const TAB_STATE_RESTORING = 2;

let ss = Cc["@mozilla.org/browser/sessionstore;1"].
         getService(Ci.nsISessionStore);

let stateBackup = ss.getBrowserState();

function cleanup() {
  // Reset the pref
  try {
    Services.prefs.clearUserPref("browser.sessionstore.max_concurrent_tabs");
  } catch (e) {}
  ss.setBrowserState(stateBackup);
  executeSoon(finish);
}

function test() {
  /** Bug 599909 - to-be-reloaded tabs don't show up in switch-to-tab **/
  waitForExplicitFinish();

  // Set the pref to 0 so we know exactly how many tabs should be restoring at
  // any given time. This guarantees that a finishing load won't start another.
  Services.prefs.setIntPref("browser.sessionstore.max_concurrent_tabs", 0);

  let state = { windows: [{ tabs: [
    { entries: [{ url: "http://example.org/#1" }] },
    { entries: [{ url: "http://example.org/#2" }] },
    { entries: [{ url: "http://example.org/#3" }] },
    { entries: [{ url: "http://example.org/#4" }] }
  ], selected: 1 }] };

  let tabsForEnsure = {};
  state.windows[0].tabs.forEach(function(tab) {
    tabsForEnsure[tab.entries[0].url] = 1;
  });

  let tabsRestoring = 0;
  let tabsRestored = 0;

  function handleEvent(aEvent) {
    if (aEvent.type == "SSTabRestoring")
      tabsRestoring++;
    else
      tabsRestored++;

    if (tabsRestoring < state.windows[0].tabs.length ||
        tabsRestored < 1)
      return;

    gBrowser.tabContainer.removeEventListener("SSTabRestoring", handleEvent, true);
    gBrowser.tabContainer.removeEventListener("SSTabRestored", handleEvent, true);
    executeSoon(function() {
      checkAutocompleteResults(tabsForEnsure, cleanup);
    });
  }

  // currentURI is set before SSTabRestoring is fired, so we can sucessfully check
  // after that has fired for all tabs. Since 1 tab will be restored though, we
  // also need to wait for 1 SSTabRestored since currentURI will be set, unset, then set.
  gBrowser.tabContainer.addEventListener("SSTabRestoring", handleEvent, true);
  gBrowser.tabContainer.addEventListener("SSTabRestored", handleEvent, true);
  ss.setBrowserState(JSON.stringify(state));
}

// The following was taken from browser/base/content/test/browser_tabMatchesInAwesomebar.js
// so that we could do the same sort of checking.
var gController = Cc["@mozilla.org/autocomplete/controller;1"].
                  getService(Ci.nsIAutoCompleteController);

function checkAutocompleteResults(aExpected, aCallback) {
  gController.input = {
    timeout: 10,
    textValue: "",
    searches: ["history"],
    searchParam: "enable-actions",
    popupOpen: false,
    minResultsForPopup: 0,
    invalidate: function() {},
    disableAutoComplete: false,
    completeDefaultIndex: false,
    get popup() { return this; },
    onSearchBegin: function() {},
    onSearchComplete:  function ()
    {
      info("Found " + gController.matchCount + " matches.");
      // Check to see the expected uris and titles match up (in any order)
      for (let i = 0; i < gController.matchCount; i++) {
        let uri = gController.getValueAt(i).replace(/^moz-action:[^,]+,/i, "");

        info("Search for '" + uri + "' in open tabs.");
        ok(uri in aExpected, "Registered open page found in autocomplete.");
        // Remove the found entry from expected results.
        delete aExpected[uri];
      }

      // Make sure there is no reported open page that is not open.
      for (let entry in aExpected) {
        ok(false, "'" + entry + "' not found in autocomplete.");
      }

      executeSoon(aCallback);
    },
    setSelectedIndex: function() {},
    get searchCount() { return this.searches.length; },
    getSearchAt: function(aIndex) this.searches[aIndex],
    QueryInterface: XPCOMUtils.generateQI([
      Ci.nsIAutoCompleteInput,
      Ci.nsIAutoCompletePopup,
    ])
  };

  info("Searching open pages.");
  gController.startSearch(Services.prefs.getCharPref("browser.urlbar.restrict.openpage"));
}
