sap.ui.define([
], function() {
	"use strict";

	const aPropertyInfos = [{
		key: "contentHash",
		isKey: true,
		label: "Content Hash",
		path: "contentHash",
		dataType: "sap.ui.model.type.String",
		visible: false,
		filterable: false
	},{
		key: "customer",
		label: "Customer",
		path: "customer",
		dataType: "sap.ui.model.type.String",
		visible: false
	},{
		key: "partner",
		label: "Partner",
		path: "partner",
		dataType: "sap.ui.model.type.String",
		visible: false
	},{
		key: "speakerName",
		label: "Speaker",
		path: "speakerName",
		dataType: "sap.ui.model.type.String",
		visible: false
	},{
		key: "customer_speaker",
		label: "Customer / Speaker",
		propertyInfos: ["customer", "speakerName"],
		visualSettings: {widthCalculation: {verticalArrangement: true}}
	},{
		key: "title",
		label: "Session Title",
		path: "title",
		dataType: "sap.ui.model.type.String"
	},{
		key: "event",
		label: "Event",
		path: "event",
		dataType: "sap.ui.model.type.String"
	},{
		key: "eventType",
		label: "Event Type",
		path: "eventType",
		dataType: "sap.ui.model.type.String"
	},{
		key: "year",
		label: "Year",
		path: "year",
		dataType: "sap.ui.model.type.Integer"
	},{
		key: "solutionArea",
		label: "Solution Area",
		path: "solutionArea",
		dataType: "sap.ui.model.type.String"
	},{
		key: "industry",
		label: "Industry",
		path: "industry",
		dataType: "sap.ui.model.type.String"
	},{
		key: "btpServices",
		label: "BTP Services",
		path: "btpServices",
		dataType: "sap.ui.model.type.String"
	},{
		key: "speakerTitleRole",
		label: "Speaker Role",
		path: "speakerTitleRole",
		dataType: "sap.ui.model.type.String"
	},{
		key: "videoVoiceRecording",
		label: "Video / Recording",
		path: "videoVoiceRecording",
		dataType: "sap.ui.model.type.String",
		filterable: false
	},{
		key: "contentSlidesSkript",
		label: "Slides / Script",
		path: "contentSlidesSkript",
		dataType: "sap.ui.model.type.String",
		filterable: false,
		visible: false
	},{
		key: "eventHomepage",
		label: "Event Homepage",
		path: "eventHomepage",
		dataType: "sap.ui.model.type.String",
		filterable: false
	},{
		key: "eventCategory",
		label: "Event Category",
		path: "eventCategory",
		dataType: "sap.ui.model.type.String"
	},{
		key: "eventOwnerName",
		label: "Event Owner",
		path: "eventOwnerName",
		dataType: "sap.ui.model.type.String"
	},{
		key: "audience",
		label: "Audience",
		path: "audience",
		dataType: "sap.ui.model.type.String"
	},{
		key: "quartal",
		label: "Quarter",
		path: "quartal",
		dataType: "sap.ui.model.type.String"
	},{
		key: "topic",
		label: "Topic",
		path: "topic",
		dataType: "sap.ui.model.type.String"
	},{
		key: "loBs",
		label: "LoBs",
		path: "loBs",
		dataType: "sap.ui.model.type.String"
	},{
		key: "sapCospeaker",
		label: "SAP Co-speaker",
		path: "sapCospeaker",
		dataType: "sap.ui.model.type.String"
	},{
		key: "sapContactToSpeaker",
		label: "SAP Contact",
		path: "sapContactToSpeaker",
		dataType: "sap.ui.model.type.String"
	},{
		key: "partnerCospeaker",
		label: "Partner Co-speaker",
		path: "partnerCospeaker",
		dataType: "sap.ui.model.type.String"
	},{
		key: "partnerContactToSpeaker",
		label: "Partner Contact",
		path: "partnerContactToSpeaker",
		dataType: "sap.ui.model.type.String"
	},{
		key: "industrie",
		label: "Industrie",
		path: "industrie",
		dataType: "sap.ui.model.type.String",
		visible: true
	},{
		key: "ratingSeniority",
		label: "Rating Seniority",
		path: "ratingSeniority",
		dataType: "sap.ui.model.type.Integer"
	},{
		key: "ratingEvent",
		label: "Rating Event",
		path: "ratingEvent",
		dataType: "sap.ui.model.type.Integer"
	},{
		key: "ratingCompany",
		label: "Rating Company",
		path: "ratingCompany",
		dataType: "sap.ui.model.type.Integer"
	},
	{
		key: "schemaVersion",
		label: "Schema Version",
		path: "schemaVersion",
		dataType: "sap.ui.model.type.String",
		visible: false,
		filterable: false
	},
	{
		key: "processedAt",
		label: "Processed At",
		path: "processedAt",
		dataType: "sap.ui.model.type.String",
		visible: false,
		filterable: false
	},
	{
		key: "sourceFile",
		label: "Source File",
		path: "sourceFile",
		dataType: "sap.ui.model.type.String",
		visible: false,
		filterable: false
	},
	{
		key: "id",
		label: "ID",
		path: "id",
		dataType: "sap.ui.model.type.Integer",
		visible: false,
		filterable: true
	}
	// ,{
	// 	key: "search",
	// 	label: "Semantic Search",
	// 	dataType: "sap.ui.model.type.String",
	// 	maxConditions: 1,
	// 	filterable: true,
	// 	visible: false
	// }
];

	return aPropertyInfos;
}, /* bExport= */false);
