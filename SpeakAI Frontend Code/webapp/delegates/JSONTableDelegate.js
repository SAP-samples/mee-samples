/* eslint-disable require-await */
sap.ui.define([
	"sap/ui/mdc/TableDelegate",
	"sap/ui/mdc/table/Column",
	"sap/m/Text",
	"com/sap/aiagentspeaker/model/JSONPropertyInfo",
	"com/sap/aiagentspeaker/delegates/JSONTableFilterDelegate"
], function (
	TableDelegate,
	Column,
	Text,
	JSONPropertyInfo,
	JSONTableFilterDelegate
) {
	"use strict";

	const JSONTableDelegate = Object.assign({}, TableDelegate);

	JSONTableDelegate.fetchProperties = async () =>
		JSONPropertyInfo.filter((oPI) => oPI.key !== "$search");

	JSONTableDelegate.getFilterDelegate = () => JSONTableFilterDelegate;

	const _createColumn = (sId, oPropertyInfo) => {
		return new Column(sId, {
			propertyKey: oPropertyInfo.key,
			header: oPropertyInfo.label,
			template: new Text({
				text: {
					path: "speakers>" + oPropertyInfo.path,
					type: oPropertyInfo.dataType
				}
			})
		});
	};

	JSONTableDelegate.addItem = async (oTable, sPropertyKey) => {
		// Skip creating certain columns while still allowing them to be used for filtering.
		// This supports the requirement: properties remain in JSONPropertyInfo (so FilterBar can use them)
		// but their table columns must never be shown, even after applying a filter.
		if (["customer", "speakerName", "eventType", "partner"].includes(sPropertyKey)) {
			return null; // Returning null prevents a column from being added.
		}
		const oPropertyInfo = JSONPropertyInfo.find((oPI) => oPI.key === sPropertyKey);
		const sId = oTable.getId() + "---col-" + sPropertyKey;
		return await _createColumn(sId, oPropertyInfo);
	};

	JSONTableDelegate.updateBindingInfo = (oTable, oBindingInfo) => {
		TableDelegate.updateBindingInfo.call(JSONTableDelegate, oTable, oBindingInfo);
		oBindingInfo.path = oTable.getPayload().bindingPath;
	};

	return JSONTableDelegate;
}, /* bExport= */false);