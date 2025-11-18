/* eslint-disable require-await */
sap.ui.define([
	"com/sap/aiagentspeaker/delegates/JSONTableDelegate",
	"sap/ui/mdc/table/Column",
	"sap/m/Text",
	"sap/m/Link",
	"sap/m/ObjectIdentifier",
	"com/sap/aiagentspeaker/model/JSONPropertyInfo",
	"com/sap/aiagentspeaker/model/formatter"
], function (
	JSONTableDelegate,
	Column,
	Text,
	Link,
	ObjectIdentifier,
	JSONPropertyInfo,
	formatter
) {
	"use strict";

	const DemoTableDelegate = Object.assign({}, JSONTableDelegate);

	const _createColumn = (sId, oPropertyInfo) => {
		const needsArrayFormatter = [
			"audience", "btpServices", "solutionArea", "topic", "loBs", "industry"
		].includes(oPropertyInfo.key);
		const isLink = ["eventHomepage", "contentSlidesSkript", "videoVoiceRecording"].includes(oPropertyInfo.key);
		const oColumn = new Column(sId, {
			propertyKey: oPropertyInfo.key,
			header: oPropertyInfo.label,
			tooltip: oPropertyInfo.tooltip,
			template: isLink
				? new Link({
					text: { path: "speakers>" + oPropertyInfo.path },
					href: { path: "speakers>" + oPropertyInfo.path, formatter: formatter.normalizeUrl },
					target: "_blank",
					enabled: { path: "speakers>" + oPropertyInfo.path, formatter: v => !!formatter.normalizeUrl(v) }
				})
				: new Text(needsArrayFormatter ? {
					text: {
						parts: [{ path: "speakers>" + oPropertyInfo.path }],
						formatter: formatter.formatArrayish
					}
				} : {
					text: {
						path: "speakers>" + oPropertyInfo.path,
						type: oPropertyInfo.dataType,
						formatOptions: oPropertyInfo.formatOptions
					}
				})
		});

		if (oPropertyInfo.key === "customer_speaker") {
			// Show company rating symbols next to customer; seniority symbols next to speaker (2nd line)
			oColumn.setTemplate(new ObjectIdentifier({
				title: {
					parts: [
						{ path: "speakers>customer" },
						{ path: "speakers>ratingCompany" }
					],
					formatter: function (sCustomer, iCompanyRating) {
						if (!sCustomer) { return ""; }
						const c = Number(iCompanyRating);
						let suffix = "";
						if (c === 5) { suffix = " \u2605"; } else if (c === 4) { suffix = " \u2606"; }
						return sCustomer + suffix;
					}
				},
				text: {
					parts: [
						{ path: "speakers>speakerName" },
						{ path: "speakers>ratingSeniority" }
					],
					formatter: function (sSpeaker, iSeniorityRating) {
						if (!sSpeaker) { return ""; }
						const s = Number(iSeniorityRating);
						let suffix = "";
						if (s === 5) { suffix = " \u21D1"; } else if (s === 4) { suffix = " \u2191"; }
						return sSpeaker + suffix;
					}
				},
				tooltip: {
					parts: [
						{ path: "speakers>customer" },
						{ path: "speakers>speakerName" },
						{ path: "speakers>ratingCompany" },
						{ path: "speakers>ratingSeniority" }
					],
					formatter: function (sCustomer, sSpeaker, iCompanyRating, iSeniorityRating) {
						let base = (sCustomer || "") + (sSpeaker ? " / " + sSpeaker : "");
						const c = Number(iCompanyRating);
						const s = Number(iSeniorityRating);
						const notes = [];
						if (c === 5) { notes.push("Company Rating: 5"); } else if (c === 4) { notes.push("Company Rating: 4"); }
						if (s === 5) { notes.push("Seniority: 5"); } else if (s === 4) { notes.push("Seniority: 4"); }
						if (notes.length) { base += " (" + notes.join(", ") + ")"; }
						return base;
					}
				}
			}));
		}

		return oColumn;
	};

	DemoTableDelegate.addItem = async (oTable, sPropertyKey) => {
		// Mirror base delegate skip logic so demo table also hides these columns.
		if (["customer", "speakerName", "eventType", "partner"].includes(sPropertyKey)) {
			return null;
		}
		const oPropertyInfo = JSONPropertyInfo.find((oPI) => oPI.key === sPropertyKey);
		const sId = oTable.getId() + "---col-" + sPropertyKey;
		return await _createColumn(sId, oPropertyInfo);
	};

	return DemoTableDelegate;
}, /* bExport= */false);