var shortcutUndo;
var shortcutRedo;

function initGeneralPane()
{
	shortcutUndo         = document.getElementById('shortcutUndo');
	shortcutUndo.keyData = UndoTabService.parseShortcut(shortcutUndo.value);
	shortcutRedo         = document.getElementById('shortcutRedo');
	shortcutRedo.keyData = UndoTabService.parseShortcut(shortcutRedo.value);
}

function setShortcut(aNode)
{
		window.openDialog(
			'chrome://undotab/content/lib/keyDetecter.xul',
			'_blank',
			'chrome,modal,centerscreen,dialog=no',
			aNode.keyData,
			aNode.getAttribute('dialogMessage'),
			aNode.getAttribute('dialogButton')
		);
		if (aNode.keyData.modified) {
			aNode.value = aNode.keyData.string;
			var event = document.createEvent('UIEvents');
			event.initUIEvent('input', true, false, window, 0);
			aNode.dispatchEvent(event);
		}
}

function clearShortcut(aNode)
{
	aNode.value = '';
	aNode.keyData = UndoTabService.parseShortcut(aNode.value);
	aNode.keyData.modified = true;

	fireInputEvent(aNode);
}

function resetShortcut(aNode)
{
	var preference = document.getElementById(aNode.getAttribute('preference'));
	aNode.value = preference.value = preference.defaultValue;
	aNode.keyData = UndoTabService.parseShortcut(aNode.value);
	aNode.keyData.modified = true;

	fireInputEvent(aNode);
}

function fireInputEvent(aNode)
{
	var event = document.createEvent('UIEvents');
	event.initUIEvent('input', true, false, window, 0);
	aNode.dispatchEvent(event);
}
