/*
 UI Operations History Manager

 Usage:
   var OH = window['piro.sakura.ne.jp'].operationHistory;

   // window specific history
   OH.doUndoableTask(
     // the task which is undo-able (optional)
     function() {
       MyService.myProp = newValue;
     },

     // name of history (optional)
     'MyAddonFeature',

     // target window for the history (optional)
     window,

     // history item
     { label  : 'Change tabbar position',
       onUndo : function() { MyService.myProp = oldValue; },
       // "onRedo" is optional. If you don't specify it,
       // the undoable task becomes onRedo automatically.
       onRedo : function() { MyService.myProp = newValue; } }
   );
   OH.undo('MyAddonFeature', window);
   OH.redo('MyAddonFeature', window);

   // global history (not associated to window)
   OH.doUndoableTask(
     function() { ... }, // task
     'MyAddonFeature',
     { ... }
   );
   OH.undo('MyAddonFeature');

   // anonymous, window specific
   OH.doUndoableTask(function() { ... }, { ... }, window);
   OH.undo(window);

   // anonymous, global
   OH.doUndoableTask(function() { ... }, { ... });
   OH.undo();

   // When you want to use "window" object in the global history,
   // you should use the ID string instead of the "window" object
   // to reduce memory leak. For example...
   OH.doUndoableTask(
     function() {
       targetWindow.MyAddonService.myProp = newValue;
     },
     {
       id : OH.getWindowId(targetWindow),
       onUndo : function() {
         var w = OH.getWindowById(this.id);
         w.MyAddonService.myProp = oldValue;
       }
     }
   );

   // enumerate history entries
   var history = OH.getHistory('MyAddonFeature', window); // options are same to undo/redo
   OH.entries.forEach(function(aEntry, aIndex) {
     var item = MyService.appendItem(aEntry.label);
     if (aIndex == history.index)
       item.setAttribute('checked', true);
   });

 lisence: The MIT License, Copyright (c) 2009-2010 SHIMODA "Piro" Hiroshi
   http://www.cozmixng.org/repos/piro/fx3-compatibility-lib/trunk/license.txt
 original:
   http://www.cozmixng.org/repos/piro/fx3-compatibility-lib/trunk/operationHistory.js
   http://www.cozmixng.org/repos/piro/fx3-compatibility-lib/trunk/operationHistory.test.js
*/
(function() {
	const currentRevision = 43;

	if (!('piro.sakura.ne.jp' in window)) window['piro.sakura.ne.jp'] = {};

	var loadedRevision = 'operationHistory' in window['piro.sakura.ne.jp'] ?
			window['piro.sakura.ne.jp'].operationHistory.revision :
			0 ;
	if (loadedRevision && loadedRevision > currentRevision) {
		return;
	}

	var db;
	if (loadedRevision) {
		db = window['piro.sakura.ne.jp'].operationHistory._db ||
				window['piro.sakura.ne.jp'].operationHistory._tables; // old name
		if (!('histories' in db))
			db = { histories : db };
		window['piro.sakura.ne.jp'].operationHistory.destroy();
	}
	else {
		db = { histories : {} };
	}

	const Cc = Components.classes;
	const Ci = Components.interfaces;

	const PREF_PREFIX = 'extensions.UIOperationsHistoryManager@piro.sakura.ne.jp.';

	const Application = Cc['@mozilla.org/fuel/application;1']
					.getService(Ci.fuelIApplication);
	const Prefs = Cc['@mozilla.org/preferences;1']
					.getService(Ci.nsIPrefBranch);
	const WindowMediator = Cc['@mozilla.org/appshell/window-mediator;1']
					.getService(Ci.nsIWindowMediator);
	const SessionStore = Cc['@mozilla.org/browser/sessionstore;1']
					.getService(Ci.nsISessionStore);

	var DEBUG = false;
	try {
		DEBUG = Prefs.getBoolPref(PREF_PREFIX+'debug');
	}
	catch(e) {
	}

	const oneIndent = '   ';
	function log(aString, aLevel) {
		if (!DEBUG) return;
		aString = String(aString);
		if (aLevel) {
			let indent = '';
			for (let i = 0; i < aLevel; i++)
			{
				indent += oneIndent;
			}
			aString = aString.replace(/^/gm, indent);
		}
		Application
			.console
			.log(aString);
	}

	window['piro.sakura.ne.jp'].operationHistory = {
		revision : currentRevision,

		WINDOW_ID : 'ui-operation-history-window-id',
		ELEMENT_ID : 'ui-operation-history-element-id',

		addEntry : function()
		{
			this.doUndoableTask.apply(this, arguments);
		},

		doUndoableTask : function()
		{
			var options = this._getHistoryOptionsFromArguments(arguments);
			var history = options.history;
			log('doUndoableTask start ('+options.name+' for '+options.windowId+')', history.inOperationCount);

			var entry = options.entry;
			var registered = false;
			if (
				entry &&
				!this._getUndoingState(options.key) &&
				!this._getRedoingState(options.key)
				) {
				let f = this._getAvailableFunction(entry.onRedo, entry.onredo, entry.redo);
				if (
					!f &&
					!('onRedo' in entry) &&
					!('onredo' in entry) &&
					!('redo' in entry) &&
					options.task
					)
					entry.onRedo = options.task;
				history.addEntry(entry);
				registered = true;
			}

			history.inOperation = true;

			var error;
			var canceled;
			var selfInfo = { done : true };
			if (options.task) {
				var self = this;
				var iterator = (function() {
						var finished = true;
						try {
							canceled = options.task.call(
								this,
								{
									level   : 0,
									manager : self,
									window  : window,
									getContinuation : function() {
										finished = false;
										return function() {
											finished = true;
										};
									}
								}
							);
						}
						catch(e) {
							log(e, history.inOperationCount);
							error = e;
						}
						while (!finished)
						{
							yield true;
						}
					})();

				var onFinish = function() {
						if (registered && canceled === false) {
							history.removeEntry(entry);
							log('  => doUndoableTask canceled : '+history.inOperation+
								'\n'+history.toString(),
								history.inOperationCount);
						}
						history.inOperation = false;
						log('  => doUndoableTask finish / in operation : '+history.inOperation+
							'\n'+history.toString(),
							history.inOperationCount);
					};

				try {
					selfInfo.done = !iterator.next();
					let timer = window.setInterval(function() {
							try {
								iterator.next();
							}
							catch(e) {
								selfInfo.done = true;
								onFinish();
								window.clearInterval(timer);
							}
							finally {
								if (error)
									throw error;
							}
						}, 10);
				}
				catch(e) {
					onFinish();
				}
			}

			if (error)
				throw error;

			return selfInfo;
		},

		getHistory : function()
		{
			var options = this._getHistoryOptionsFromArguments(arguments);
			return new UIHistoryProxy(options.history);
		},

		undo : function()
		{
			var options = this._getHistoryOptionsFromArguments(arguments);
			var history = options.history;
			var undoing = this._getUndoingState(options.key);
			log('undo start ('+history.index+' / '+history.entries.length+', '+options.name+' for '+options.windowId+', '+undoing+')');
			if (!history.canUndo || undoing)
				return { done : true };

			this._setUndoingState(options.key, true);
			var processed = false;
			var error;

			var self = this;
			var iterator = (function() {
					do {
						let entries = history.currentEntries;
						--history.index;
						if (!entries.length) continue;
						log((history.index+1)+' '+entries[0].label, 1);
						let oneProcessed = false;
						let max = entries.length;
						entries = Array.slice(entries).reverse();
						for (let i in entries)
						{
							let entry = entries[i];
							log('level '+(max-i)+' '+entry.label, 2);
							let f = self._getAvailableFunction(entry.onUndo, entry.onundo, entry.undo);
							if (!f) return;
							let finished = true;
							try {
								let info = {
										level   : max-i,
										manager : self,
										window  : window,
										getContinuation : function() {
											finished = false;
											return function() {
												finished = true;
											};
										}
									};
								if (f.call(entry, info) !== false)
									oneProcessed = true;
							}
							catch(e) {
								log(e, 2);
								error = e;
								break;
							}
							while (!finished)
							{
								yield true;
							}
							self._dispatchEvent('UIOperationGlobalHistoryUndo', options, entry, oneProcessed);
						}
						if (error) break;
						processed = oneProcessed;
					}
					while (processed === false && history.canUndo);
				})();

			var onFinish = function() {
					self._setUndoingState(options.key, false);
					log('  => undo finish\n'+history.toString());
				};

			var selfInfo = { done : true };
			try {
				selfInfo.done = !iterator.next();
				let timer = window.setInterval(function() {
						try {
							iterator.next();
						}
						catch(e) {
							selfInfo.done = true;
							onFinish();
							window.clearInterval(timer);
						}
						finally {
							if (error)
								throw error;
						}
					}, 10);
			}
			catch(e) {
				onFinish();
			}

			if (error)
				throw error;

			return selfInfo;
		},

		redo : function()
		{
			var options = this._getHistoryOptionsFromArguments(arguments);
			var history = options.history;
			var max = history.entries.length;
			var redoing = this._getRedoingState(options.key);
			log('redo start ('+history.index+' / '+max+', '+options.name+' for '+options.windowId+', '+redoing+')');
			if (!history.canRedo || redoing)
				return { done : true };

			this._setRedoingState(options.key, true);
			var processed = false;
			var error;

			var self = this;
			var iterator = (function() {
					while (processed === false && history.canRedo)
					{
						++history.index;
						let entries = history.currentEntries;
						if (!entries.length) continue;
						log((history.index)+' '+entries[0].label, 1);
						let oneProcessed = false;
						for (let i in entries)
						{
							let entry = entries[i];
							log('level '+(i)+' '+entry.label, 2);
							let f = self._getAvailableFunction(entry.onRedo, entry.onredo, entry.redo);
							if (!f) return;
							let finished = true;
							try {
								let info = {
										level   : i,
										manager : self,
										window  : window,
										getContinuation : function() {
											finished = false;
											return function() {
												finished = true;
											};
										}
									};
								if (f.call(entry, info) !== false)
									oneProcessed = true;
							}
							catch(e) {
								log(e, 2);
								error = e;
								break;
							}
							while (!finished)
							{
								yield true;
							}
							self._dispatchEvent('UIOperationGlobalHistoryRedo', options, entry, oneProcessed);
						}
						if (error) break;
						processed = oneProcessed;
					}
				})();

			var onFinish = function() {
					self._setRedoingState(options.key, false);
					log('  => redo finish\n'+history.toString());
				};

			var selfInfo = { done : true };
			try {
				selfInfo.done = !iterator.next();
				let timer = window.setInterval(function() {
						try {
							iterator.next();
						}
						catch(e) {
							selfInfo.done = true;
							onFinish();
							window.clearInterval(timer);
						}
						finally {
							if (error)
								throw error;
						}
					}, 10);
			}
			catch(e) {
				onFinish();
			}

			if (error)
				throw error;

			return selfInfo;
		},

		goToIndex : function()
		{
			var options = this._getHistoryOptionsFromArguments(arguments);
			var history = options.history;
			var index = Math.max(0, Math.min(history.entries.length-1, options.index));
			var current = history.index;

			if (index == current)
				return { done : true };

			var self = this;
			var iterator = (function() {
					while (true)
					{
						let info;
						if (index < current) {
							if (history.index <= index)
								break;
							info = self.undo(options.name, options.window);
						}
						else {
							if (history.index >= index)
								break;
							info = self.redo(options.name, options.window);
						}

						while (!info.done)
						{
							yield true;
						}
					}
				})();

			var selfInfo = { done : true };
			try {
				selfInfo.done = !iterator.next();
				let timer = window.setInterval(function() {
						try {
							iterator.next();
						}
						catch(e) {
							selfInfo.done = true;
							window.clearInterval(timer);
						}
					}, 10);
			}
			catch(e) {
			}

			return selfInfo;
		},

		isUndoing : function()
		{
			var options = this._getHistoryOptionsFromArguments(arguments);
			return this._getUndoingState(options.key);
		},
		isRedoing : function()
		{
			var options = this._getHistoryOptionsFromArguments(arguments);
			return this._getRedoingState(options.key);
		},

		syncWindowHistoryFocus : function(aOptions)
		{
			if (!aOptions.currentEntry)
				throw new Error('currentEntry must be specified!');
			if (!aOptions.entries)
				throw new Error('entries must be specified!');
			if (!aOptions.windows)
				throw new Error('windows must be specified!');
			if (aOptions.entries.length != aOptions.windows.length)
				throw new Error('numbers of entries and windows must be same!');

			var name = aOptions.name || 'window';

			log('syncWindowHistoryFocus for '+name+' ('+aOptions.currentEntry.label+')');

			aOptions.entries.forEach(function(aEntry, aIndex) {
				var history = this.getHistory(name, aOptions.windows[aIndex]);
				var currentEntries = history.currentEntries;
				if (currentEntries.indexOf(aOptions.currentEntry) > -1) {
					return;
				}
				if (currentEntries.indexOf(aEntry) > -1) {
					log(name+' is synced for '+aIndex+' ('+aEntry.label+')');
					history.index--;
				}
			}, this);
		},

		clear : function()
		{
			var options = this._getHistoryOptionsFromArguments(arguments);
			return options.history.clear();
		},


		getWindowId : function(aWindow, aDefaultId)
		{
			var root = aWindow.document.documentElement;
			var id = root.getAttribute(this.WINDOW_ID) || aDefaultId;
			try {
				if (!id)
					id = SessionStore.getWindowValue(aWindow, this.WINDOW_ID);
			}
			catch(e) {
			}
			return this.setWindowId(aWindow, id);
		},

		setWindowId : function(aWindow, aDefaultId)
		{
			var id = aDefaultId;
			var root = aWindow.document.documentElement;

			// When the ID has been already used by other window,
			// we have to create new ID for this window.
			var windows = this._getWindowsById(id);
			var forceNewId = windows.length && (windows.length > 1 || windows[0] != aWindow);

			if (!id || forceNewId)
				id = 'window-'+Date.now()+parseInt(Math.random() * 65000);

			if (root.getAttribute(this.WINDOW_ID) != id) {
				root.setAttribute(this.WINDOW_ID, id);
				try {
					SessionStore.setWindowValue(aWindow, this.WINDOW_ID, id);
				}
				catch(e) {
				}
			}
			return id;
		},

		getWindowById : function(aId)
		{
			var targets = WindowMediator.getZOrderDOMWindowEnumerator(null, true);
			while (targets.hasMoreElements())
			{
				let target = targets.getNext().QueryInterface(Ci.nsIDOMWindowInternal);
				if (aId == this.getWindowId(target))
					return target;
			}
			return null;
		},

		getElementId : function(aElement, aDefaultId)
		{
			var id = aElement.getAttribute(this.ELEMENT_ID) || aDefaultId;
			try {
				if (!id && aElement.localName == 'tab')
					id = SessionStore.getTabValue(aElement, this.ELEMENT_ID);
			}
			catch(e) {
			}
			return this.setElementId(aElement, id);
		},

		setElementId : function(aElement, aDefaultId)
		{
			var id = aDefaultId;

			// When the ID has been already used by other elements,
			// we have to create new ID for this element.
			var elements = this._getElementsById(id, aElement.parentNode || aElement.ownerDocument);
			var forceNewId = elements.length && (elements.length > 1 || elements[0] != aElement);

			if (!id || forceNewId)
				id = 'element-'+Date.now()+parseInt(Math.random() * 65000);

			if (aElement.getAttribute(this.ELEMENT_ID) != id) {
				aElement.setAttribute(this.ELEMENT_ID, id);
				try {
					if (aElement.localName == 'tab')
						SessionStore.setTabValue(aElement, this.ELEMENT_ID, id);
				}
				catch(e) {
				}
			}
			return id;
		},

		setBindingParentId : function(aNode, aDefaultId)
		{
			var parent = aNode.ownerDocument.getBindingParent(aNode);
			return parent ? this.setElementId(parent, aDefaultId) : null ;
		},

		getWindowById : function(aId)
		{
			if (!aId)
				throw new Error('window id must be specified.');
			var targets = WindowMediator.getZOrderDOMWindowEnumerator(null, true);
			while (targets.hasMoreElements())
			{
				let target = targets.getNext().QueryInterface(Ci.nsIDOMWindowInternal);
				if (aId == this.getWindowId(target))
					return target;
			}
			return null;
		},

		getElementById : function()
		{
			var options = this._getElementOptionsFromArguments(arguments);
			if (!options.id)
				throw new Error('element id must be specified.');
			return this._evaluateXPath(
					'descendant::*[@'+this.ELEMENT_ID+'="'+options.id+'"][1]',
					options.parent,
					Ci.nsIDOMXPathResult.FIRST_ORDERED_NODE_TYPE
				).singleNodeValue;
		},

		getId : function(aTarget, aDefaultId)
		{
			if (aTarget instanceof Ci.nsIDOMWindow)
				return this.getWindowId(aTarget, aDefaultId);
			if (aTarget instanceof Ci.nsIDOMDocument)
				return this.getWindowId(aTarget.defaultView, aDefaultId);
			if (aTarget instanceof Ci.nsIDOMElement)
				return this.getElementId(aTarget, aDefaultId);
			throw new Error(aTarget+' is an unknown type item.');
		},

		getBindingParentId : function(aNode, aDefaultId)
		{
			var parent = aNode.ownerDocument.getBindingParent(aNode);
			return parent ? this.getId(parent, aDefaultId) : null ;
		},

		getTargetById : function()
		{
			var id;
			Array.slice(arguments).some(function(aArg) {
				if (typeof aArg == 'string')
					return id = aArg;
				return false;
			});
			if (!id)
				throw new Error('target id must be specified.');

			if (id.indexOf('window-') == 0)
				return this.getWindowById.apply(this, arguments);
			if (id.indexOf('element-') == 0)
				return this.getElementById.apply(this, arguments);

			throw new Error(id+' is an unknown type id.');
		},

		getTargetsByIds : function()
		{
			var ids = [];
			var otherArgs = [];
			Array.slice(arguments).forEach(function(aArg) {
				if (typeof aArg == 'string')
					ids.push(aArg);
				else
					otherArgs.push(aArg);
			});
			if (!ids.length)
				throw new Error('target id must be specified.');

			return ids.map(function(aId) {
					return this.getTargetById.apply(this, [aId].concat(otherArgs));
				}, this);
		},

		getRelatedTargetsByIds : function(aIds, aRootParent) 
		{
			var results = [];
			var lastParent = aRootParent;
			aIds.some(function(aId) {
				try {
					var lastResult;
					if (typeof aId != 'string') {
						lastReuslt = this.getTargetsByIds(aId, lastParent);
						lastParent = lastParent[0];
					}
					else {
						lastReuslt = this.getTargetById(aId, lastParent);
						lastParent = lastReuslt;
					}
					results.push(lastReuslt);
					return false;
				}
				catch(e) {
					return e;
				}
			}, this);
			return results;
		},


		/* PRIVATE METHODS */

		_db : db,

		initialized : false,

		init : function()
		{
			// inherit history table from existing window
			var targets = WindowMediator.getZOrderDOMWindowEnumerator(null, true);
			while (targets.hasMoreElements())
			{
				let target = targets.getNext().QueryInterface(Ci.nsIDOMWindowInternal);
				if (
					'piro.sakura.ne.jp' in target &&
					'operationHistory' in target['piro.sakura.ne.jp'] &&
					target['piro.sakura.ne.jp'].operationHistory.initialized
					) {
					this._db = target['piro.sakura.ne.jp'].operationHistory._db;
					break;
				}
			}

			window.addEventListener('unload', this, false);

			this._initDBAsObserver();

			this.initialized = true;
		},

		_initDBAsObserver : function()
		{
			if ('observerRegistered' in this._db)
				return;

			this._db.observerRegistered = true;
			this._db.observe = function(aSubject, aTopic, aData) {
				switch (aTopic)
				{
					case 'private-browsing':
						switch (aData)
						{
							case 'enter':
							case 'exit':
								for (let i in this.histories)
								{
									this.histories[i].clear();
								}
								this.histories = {};
								break;
						}
						break;
				}
			};
			Cc['@mozilla.org/observer-service;1']
				.getService(Ci.nsIObserverService)
				.addObserver(this._db, 'private-browsing', false);
		},

		destroy : function()
		{
			window.removeEventListener('unload', this, false);
		},

		_dispatchEvent : function(aType, aOptions, aEntry, aProcessed)
		{
			var d = aOptions.window ? aOptions.window.document : document ;
			var event = d.createEvent('Events');
			event.initEvent(aType, true, false);
			event.name  = aOptions.name;
			event.entry = aEntry;
			event.data  = aEntry; // old name
			event.processed = aProcessed || false;
			event.done      = aProcessed || false; // old name
			d.dispatchEvent(event);
		},

		_evaluateXPath : function(aExpression, aContext, aType) 
		{
			try {
				var doc = aContext.ownerDocument || aContext;
				var xpathResult = doc.evaluate(
						aExpression,
						aContext,
						null,
						aType,
						null
					);
			}
			catch(e) {
				return {
					singleNodeValue : null,
					snapshotLength  : 0,
					snapshotItem    : function() {
						return null
					}
				};
			}
			return xpathResult;
		},

		_getHistoryOptionsFromArguments : function(aArguments)
		{
			var w     = null,
				name  = '',
				entry = null,
				task  = null,
				index = -1;
			Array.slice(aArguments).some(function(aArg) {
				if (aArg instanceof Ci.nsIDOMWindow)
					w = aArg;
				else if (typeof aArg == 'string')
					name = aArg;
				else if (typeof aArg == 'number')
					index = aArg;
				else if (typeof aArg == 'function')
					task = aArg;
				else if (aArg)
					entry = aArg;
			});

			var type = w ? 'window' : 'global' ;
			if (!name)
				name = type;

			var windowId = w ? this.getWindowId(w) : null ;
			var history = this._getHistoryFor(name, w);

			return {
				name     : name,
				window   : w,
				windowId : windowId,
				key      : encodeURIComponent(name)+'::'+type,
				entry    : entry,
				history  : history,
				task     : task,
				index    : index
			};
		},

		_getElementOptionsFromArguments : function(aArguments)
		{
			var id       = '',
				document = null,
				parent   = null;
			Array.slice(aArguments).forEach(function(aArg) {
				if (typeof aArg == 'string')
					id = aArg;
				else if (aArg instanceof Ci.nsIDOMDocument)
					document = aArg;
				else if (aArg instanceof Ci.nsIDOMWindow)
					document = aArg.document;
				else if (aArg instanceof Ci.nsIDOMNode)
					parent = aArg;
			});

			if (!document) {
				if (parent)
					document = parent.ownerDocument;
				else
					document = window.document;
			}

			if (!parent)
				parent = document;

			return {
				id       : id,
				parent   : parent,
				document : document
			};
		},

		_getHistoryFor : function(aName, aWindow)
		{
			var uniqueName = encodeURIComponent(aName);

			var windowId = aWindow ? this.getWindowId(aWindow) : null ;
			if (windowId)
				uniqueName += '::'+windowId;

			if (!(uniqueName in this._db.histories)) {
				this._db.histories[uniqueName] = new UIHistory(aName, aWindow, windowId);
			}

			return this._db.histories[uniqueName];
		},

		_createContinuation : function(aType, aOptions, aInfo)
		{
			var continuation;
			var history = aOptions.history;
			var key     = aOptions.key;
			var self    = this;
			switch (aType)
			{
				case 'undoable':
					aInfo.done = false;
					continuation = function() {
						if (aInfo.allowed) {
							history.inOperation = false;
							if (!history.inOperation)
								aInfo.done = true;
						}
						aInfo.called = true;
						log('  => doUndoableTask finish (delayed) / '+
							'in operation : '+history.inOperationCount+' / '+
							'allowed : '+aInfo.allowed+
							'\n'+history.toString(),
							history.inOperationCount);
					};
					key = null;
					self = null;
					aInfo.created = true;
					break;

				case 'undo':
					continuation = function() {
						if (aInfo.allowed)
							self._setUndoingState(key, false);
						aInfo.called = true;
						log('  => undo finish (delayed)\n'+history.toString());
					};
					aInfo.created = true;
					break;

				case 'redo':
					continuation = function() {
						if (aInfo.allowed)
							self._setRedoingState(key, false);
						aInfo.called = true;
						log('  => redo finish (delayed)\n'+history.toString());
					};
					aInfo.created = true;
					break;

				case 'null':
					continuation = function() {
					};
					history = null;
					key = null;
					self = null;
					aInfo.created = true;
					aInfo = null;
					break;

				default:
					throw new Error('unknown continuation type: '+aType);
			}
			aOptions = null;
			return continuation;
		},

		_getAvailableFunction : function()
		{
			var functions = Array.slice(arguments);
			for (var i in functions)
			{
				let f = functions[i];
				if (f && typeof f == 'function')
					return f;
			}
			return null;
		},

		_deleteWindowHistories : function(aWindow)
		{
			var w = aWindow || window;
			if (!w) return;

			var removedTables = [];
			for (let i in this._db.histories)
			{
				if (w == this._db.histories[i].window)
					removedTables.push(i);
			}
			removedTables.forEach(function(aName) {
				var table = this._db.histories[aName];
				delete table.entries;
				delete table.window;
				delete table.windowId;
				delete this._db.histories[aName];
			}, this);
		},

		_getWindowsById : function(aId)
		{
			var targets = WindowMediator.getZOrderDOMWindowEnumerator(null, true);
			var windows = [];
			while (targets.hasMoreElements())
			{
				let target = targets.getNext().QueryInterface(Ci.nsIDOMWindowInternal);
				let id = target.document.documentElement.getAttribute(this.WINDOW_ID);
				try {
					if (!id)
						id = SessionStore.getWindowValue(target, this.WINDOW_ID)
				}
				catch(e) {
				}
				if (id == aId)
					windows.push(target);
			}
			return windows;
		},

		_getElementsById : function(aId, aParent)
		{
			var result = this._evaluateXPath(
					'descendant::*[@'+this.ELEMENT_ID+'="'+aId+'"][1]',
					aParent,
					Ci.nsIDOMXPathResult.ORDERED_NODE_SNAPSHOT_TYPE
				);
			var elements = [];
			for (let i = 0, maxi = result.snapshotLength; i < maxi; i++)
			{
				elements.push(result.snapshotItem(i));
			}
			return elements;
		},

		_getUndoingState : function(aKey)
		{
			return this._db.undoing && aKey in this._db.undoing;
		},
		_getRedoingState : function(aKey)
		{
			return this._db.redoing && aKey in this._db.redoing;
		},

		_setUndoingState : function(aKey, aState)
		{
			if (!('undoing' in this._db))
				this._db.undoing = {};

			if (aState)
				this._db.undoing[aKey] = true;
			else if (aKey in this._db.undoing)
				delete this._db.undoing[aKey];
		},
		_setRedoingState : function(aKey, aState)
		{
			if (!('redoing' in this._db))
				this._db.redoing = {};

			if (aState)
				this._db.redoing[aKey] = true;
			else if (aKey in this._db.redoing)
				delete this._db.redoing[aKey];
		},

		handleEvent : function(aEvent)
		{
			switch (aEvent.type)
			{
				case 'unload':
					this._deleteWindowHistories(window);
					this.destroy();
					return;
			}
		}

	};

	function UIHistory(aName, aWindow, aId)
	{
		this.name     = aName;
		this.window   = aWindow;
		this.windowId = aId;

		this.key = aName+(aId ? ' ('+aId+')' : '' )

		try {
			var max = Prefs.getIntPref(this.maxPref);
			this._max = Math.max(0, Math.min(this.MAX_ENTRIES, max));
		}
		catch(e) {
			this._max = this.MAX_ENTRIES;
		}

		this.clear();
	}
	UIHistory.prototype = {

		MAX_ENTRIES : 999,
		get maxPref()
		{
			return PREF_PREFIX+escape(this.name)+'.max.'+(this.window ? 'window' : 'global');
		},
		get max()
		{
			return this._max;
		},
		set max(aValue)
		{
			var max = parseInt(aValue);
			if (!isNaN(max)) {
				max = Math.max(0, Math.min(this.MAX_ENTRIES, max));
				try {
					if (max != this._max)
						Prefs.setIntPref(this.maxPref, max);
				}
				catch(e) {
				}
				this._max = max;
			}
			return aValue;
		},

		get safeIndex()
		{
			return Math.max(0, Math.min(this.entries.length-1, this.index));
		},

		get inOperation()
		{
			return this.inOperationCount > 0;
		},
		set inOperation(aValue)
		{
			if (aValue)
				this.inOperationCount++;
			else if (this.inOperationCount)
				this.inOperationCount--;

			return this.inOperationCount > 0;
		},

		clear : function()
		{
			log('UIHistory::clear '+this.key);
			this.entries  = [];
			this.metaData = [];
			this.index    = -1;
			this.inOperationCount = 0;
		},

		addEntry : function(aEntry)
		{
			log('UIHistory::addEntry '+this.key+
				'\n  '+aEntry.label+
				'\n  in operation : '+this.inOperationCount,
				this.inOperationCount);
			if (this.inOperation) {
				let metaData = this.lastMetaData;
				metaData.children.push(aEntry);
				metaData.names.push(aEntry.name);
				log(' => level '+metaData.children.length+' (child)', this.inOperationCount);
			}
			else {
				this._addNewEntry(aEntry);
				log(' => level 0 (new entry at '+(this.entries.length-1)+')', this.inOperationCount);
			}
		},
		_addNewEntry : function(aEntry)
		{
			this.entries = this.entries.slice(0, this.index+1);
			this.entries.push(aEntry);
			this.entries = this.entries.slice(-this.max);

			var metaData = new UIHistoryMetaData();
			metaData.names.push(aEntry.name);

			this.metaData = this.metaData.slice(0, this.index+1);
			this.metaData.push(metaData);
			this.metaData = this.metaData.slice(-this.max);

			this.index = this.entries.length;
		},

		removeEntry : function(aEntry)
		{
			for (let i = this.safeIndex; i > -1; i--)
			{
				let index = this._getEntriesAt(i).indexOf(aEntry);
				if (index < 0) continue;

				if (index == 0) {
					this.entries.splice(index, 1);
					this.metaData.splice(index, 1);
					this.index--;
				}
				else {
					this.metaData[i].children.splice(index-1, 1);
				}
				break;
			}
		},

		get canUndo()
		{
			return this.index >= 0;
		},
		get canRedo()
		{
			return this.index < this.entries.length;
		},

		get currentEntry()
		{
			return this.entries[this.index] || null ;
		},
		get lastEntry()
		{
			return this.entries[this.entries.length-1];
		},

		get currentMetaData()
		{
			return this.metaData[this.index] || null ;
		},
		get lastMetaData()
		{
			return this.metaData[this.metaData.length-1];
		},

		_getEntriesAt : function(aIndex)
		{
			let entry = this.entries[aIndex];
			if (!entry) return [];
			let metaData = this.metaData[aIndex];
			return [entry].concat(metaData.children);
		},
		get currentEntries()
		{
			return this._getEntriesAt(this.index);
		},
		get lastEntries()
		{
			return this._getEntriesAt(this.entries.length-1);
		},

		_getPromotionOptions : function(aArguments)
		{
			var entry, names = [];
			Array.slice(aArguments).forEach(function(aArg) {
				if (typeof aArg == 'string')
					names.push(aArg);
				else if (typeof aArg == 'object')
					entry = aArg;
			});
			return [entry, names];
		},

		toString : function()
		{
			try {
				var entries = this.entries;
				var metaData = this.metaData;
				var index = this.index;
				var string = entries
								.map(function(aEntry, aIndex) {
									var children = metaData[aIndex].children.length;
									children = children ? ' ('+children+')' : '' ;
									var name = aEntry.name;
									name = name ? ' ['+name+']' : '' ;
									return (aIndex == index ? '*' : ' ' )+
											' '+aIndex+': '+aEntry.label+
											name+
											children;
								}, this)
								.join('\n');
				if (index < 0)
					string = '* -1: -----\n' + string;
				else if (index >= entries.length)
					string += '\n* '+entries.length+': -----';

				return this.key+'\n'+string;
			}
			catch(e) {
				return this.key+'\n'+e;
			}
		}
	};

	function UIHistoryProxy(aHistory)
	{
		this._original = aHistory;
	}
	UIHistoryProxy.prototype = {
		__proto__ : UIHistory.prototype,

		get index()
		{
			return this._original.safeIndex;
		},
		set index(aValue)
		{
			this._original.index = aValue;
			return aValue;
		},

		get entries()
		{
			return this._original.entries;
		},
		set entries(aValue)
		{
			this._original.entries = aValue;
			return aValue;
		},

		get metaData()
		{
			return this._original.metaData;
		},
		set metaData(aValue)
		{
			this._original.metaData = aValue;
			return aValue;
		},

		get inOperationCount()
		{
			return this._original.inOperationCount;
		},
		set inOperationCount(aValue)
		{
			this._original.inOperationCount = aValue;
			return aValue;
		},

		clear : function()
		{
			return this._original.clear();
		}
	};

	function UIHistoryMetaData()
	{
		this.clear();
	}
	UIHistoryMetaData.prototype = {
		clear : function()
		{
			this.children = [];
			this.names    = [];
			this.insertionTargets = {};
		},

		registerInsertionTarget : function(aEntry, aNames)
		{
			aNames.forEach(function(aName) {
				if (!this.insertionTargets[aName])
					this.insertionTargets[aName] = [];
				this.insertionTargets[aName].push(aEntry);
			}, this);
		}
	};

	// export
	window['piro.sakura.ne.jp'].operationHistory.UIHistory         = UIHistory;
	window['piro.sakura.ne.jp'].operationHistory.UIHistoryProxy    = UIHistoryProxy;
	window['piro.sakura.ne.jp'].operationHistory.UIHistoryMetaData = UIHistoryMetaData;

	window['piro.sakura.ne.jp'].operationHistory.init();
})();
