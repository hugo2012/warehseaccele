sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ndc/BarcodeScanner",
    "sap/m/MessageToast",
    "sap/m/BusyDialog",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/ui/core/HTML"
], function (Controller, JSONModel, Filter, FilterOperator, BarcodeScanner, MessageToast, BusyDialog, Dialog, Button, HTML) {
    "use strict";

    return Controller.extend("com.bosh.sd.warehseaccele.controller.Main", {

        onInit: function () {
            this._oBusyDialog = new BusyDialog();
            
            var oViewModel = new JSONModel({
                DeliveryNumber: "",
                HandlingUnit: "",
                huList: [],
                asnDetails: []
            });
            this.getView().setModel(oViewModel, "viewModel");
        },
        // --- FILTER SECTION LOGIC ---
        onApplyFilter: function () {
           var HuNumber= this.getView().getModel("viewModel").getProperty("/HandlingUnit");
           var deliveryNumber= this.getView().getModel("viewModel").getProperty("/DeliveryNumber");
           if(HuNumber){
             this._processScan(HuNumber);
           }
           else if(deliveryNumber){
            this._processScan(deliveryNumber);
           }
           else{
                if(!deliveryNumber && !HuNumber){
                    this.getView().getModel("viewModel").setProperty("/huList", []);
                    this.getView().getModel("viewModel").setProperty("/asnDetails", []);
                    sap.m.MessageBox.show("Please enter Handling Unit or DeliveryNumber!", {
                    icon: sap.m.MessageBox.Icon.ERROR,
                    title: "Error"
                    });
                }
           }
        },
        // --- BARCODE SCANNER BUTTON ---
        onScanPress: function () {
            var oController = this;

            BarcodeScanner.scan(
                function (mResult) {
                    if (!mResult.cancelled && mResult.text) {
                        MessageToast.show("Scanned Barcode: " + mResult.text);
                        
                        // 1. Auto-fill HU Number model property
                        oController.getView().getModel("viewModel").setProperty("/HandlingUnit", mResult.text);

                        // 2. Trigger Process Scan
                        
                        oController._processScan(mResult.text);
                    }
                },
                function (Error) {
                    MessageToast.show("Scanning failed: " + Error);
                }
            );
        },

        // --- CAMERA CAPTURE DIALOG ---
        onCapturePress: function () {
            var oController = this;

            var oCameraHtml = new HTML({
                content: "<div style='text-align:center;'><video id='liveWebcamVideo' width='100%' height='240' autoplay style='border:1px solid #ccc;'></video></div>"
            });

            var oCaptureDialog = new Dialog({
                title: "Capture & Read Barcode",
                contentWidth: "400px",
                contentHeight: "300px",
                content: [oCameraHtml],
                beginButton: new Button({
                    text: "Capture Image",
                    type: "Emphasized",
                    press: function () {
                        oController._takeSnapshot();
                        oCaptureDialog.close();
                    }
                }),
                endButton: new Button({
                    text: "Cancel",
                    press: function () {
                        oCaptureDialog.close();
                    }
                }),
                afterOpen: function () {
                    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                        navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
                            .then(function (stream) {
                                oController._mediaStream = stream;
                                var videoElement = document.getElementById("liveWebcamVideo");
                                if (videoElement) {
                                    videoElement.srcObject = stream;
                                }
                            })
                            .catch(function (err) {
                                MessageToast.show("Unable to access camera: " + err);
                            });
                    }
                },
                afterClose: function () {
                    if (oController._mediaStream) {
                        oController._mediaStream.getTracks().forEach(function (track) {
                            track.stop();
                        });
                    }
                    oCaptureDialog.destroy();
                }
            });

            oCaptureDialog.open();
        },

       // --- TAKE SNAPSHOT AND PASS FILE/BLOB TO AI API ---
        _takeSnapshot: function () {
            var oController = this;
            var videoElement = document.getElementById("liveWebcamVideo");

            if (!videoElement) {
                sap.m.MessageToast.show("Webcam stream not available.");
                return;
            }

            // 1. Open busy indicator
            if (this._oBusyDialog) {
                this._oBusyDialog.open();
            }

            // 2. Render snapshot frame on canvas
            var canvas = document.createElement("canvas");
            canvas.width = videoElement.videoWidth || 640;
            canvas.height = videoElement.videoHeight || 480;

            var ctx = canvas.getContext("2d");
            ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

            // 3. Convert Canvas content to Blob/File object (JPEG offers smaller payload than PNG)
            canvas.toBlob(function (oBlob) {
                if (!oBlob) {
                    if (oController._oBusyDialog) {
                        oController._oBusyDialog.close();
                    }
                    sap.m.MessageToast.show("Failed to capture image snapshot.");
                    return;
                }

                // Stop webcam stream after successful capture
                oController._stopWebcamStream();

                // 4. Convert Blob to File object so FastAPI receives a proper filename
                var oSnapshotFile = new File([oBlob], "webcam_snapshot.jpg", { type: "image/jpeg" });
                 var sFileName = oSnapshotFile.name;
                // 5. Pass File object directly to your updated FastAPI REST call method
                oController._sendImageToAiApi(oSnapshotFile, sFileName);

            }, "image/jpeg", 0.9); // 0.9 quality ratio
        },

    // Optional helper to stop camera stream after capture
    _stopWebcamStream: function () {
        var videoElement = document.getElementById("liveWebcamVideo");
        if (videoElement && videoElement.srcObject) {
            var stream = videoElement.srcObject;
            var tracks = stream.getTracks();
            tracks.forEach(function (track) {
                track.stop();
            });
            videoElement.srcObject = null;
        }
    },

        // --- OData V4 CALL: FETCH HUs FROM BARCODE DATA ---
        _processScan: function (sScanInput) {
            var oController = this;
            var oODataModel = this.getView().getModel();
            this._oBusyDialog.open();
            oController.getView().getModel("viewModel").setProperty("/huList", []);
            oController.getView().getModel("viewModel").setProperty("/asnDetails", []);

            var oListBinding = oODataModel.bindList("/DeliveryHU", null, null, [
                new Filter("ScanInput", FilterOperator.EQ, sScanInput)
            ]);

            oListBinding.requestContexts().then(function (aContexts) {
                var aResults = aContexts.map(function (oContext) {
                    return oContext.getObject();
                });
                oController._evaluateAIModel(aResults);

            }).catch(function (oError) {
                oController._oBusyDialog.close();
                
            });
        },

        _evaluateAIModel: function (aHuData) {
            var oController = this;
            setTimeout(function () {
                var aUpdatedHuList = aHuData.map(function (item, index) {
                    return {
                        DeliveryNumber: item.DeliveryNumber || item.Delivery,
                        HandlingUnit: item.HandlingUnit || item.HandlingUnit || item.ScanInput
                       // ConfidenceScore: index === 0 ? 85 : "",
                       // ValidationStatus: index === 0 ? "SUCCESS" : "WARNING"
                    };
                });

                var oViewModel = oController.getView().getModel("viewModel");
                oViewModel.setProperty("/huList", aUpdatedHuList);
                oController._oBusyDialog.close();
            }, 400);
        },

        // --- ROW SCAN -> ASN TABLE FETCH ---
        onRowScanPress: function (oEvent) {
            var oItemContext = oEvent.getSource().getBindingContext("viewModel").getObject();
            var sDeliveryNumber = oItemContext.DeliveryNumber;
            this._fetchASNDetails(sDeliveryNumber);
        },

        _fetchASNDetails: function (sDeliveryNumber) {
            var oController = this;
            var oODataModel = this.getView().getModel();
            this._oBusyDialog.open();
           var oAsnBinding = oODataModel.bindList("/DeliveryASN", null, null, [
                new Filter("DeliveryNumber", FilterOperator.EQ, sDeliveryNumber)
            ]);
            oAsnBinding.requestContexts().then(function (aContexts) {
                var aAsnResults = aContexts.map(function (oContext) {
                    return oContext.getObject();
                });
                oController._processAsnData(aAsnResults);

            }).catch(function (oError) {

            });
        },

        _processAsnData: function (aAsnData) {
            var aProcessedASN = aAsnData.map(function (item) {
                var sDetail = item.StatusDescription ;
              //  var aMessages = aDetailsList.map(function (msg) { return { text: msg }; });
                var aDynamicActions = [];

               // aDetailsList.forEach(function (sDetail) {
                    var sText = sDetail.toLowerCase();
                    if (sText.includes("record missing") || sText.includes("asn sent") || sText.includes("asn")) {
                        aDynamicActions.push({
                            text: "Send Email",
                            type: "Accept",
                            actionKey: "SEND_EMAIL",
                            DeliveryNumber: item.DeliveryNumber,
                            ConsignmentOrder: item.ConsignmentOrder
                        });
                    }
                    else{
                        if (sText.includes("partner profile missing")) {
                            aDynamicActions.push({
                                text: "Create Partner profile",
                                type: "Default",
                                actionKey: "CREATE_PARTNER_PROFILE",
                                DeliveryNumber: item.DeliveryNumber,
                                ConsignmentOrder: item.ConsignmentOrder
                            });
                        }
                    }
                     aDynamicActions.push({
                                text: "Fix & Retrigger",
                                type: "Attention",
                                actionKey: "RE_TRIGGER",
                                DeliveryNumber: item.DeliveryNumber,
                                ConsignmentOrder: item.ConsignmentOrder
                            });
               // });

                return {
                    ConsignmentOrder: item.ConsignmentOrder,
                    ASNStatus: item.ASNStatus,
                    ASNCreatedDate: item.ASNCreatedDate,
                    StatusDescription: item.StatusDescription,
                    DynamicActions: aDynamicActions
                };
            });

            this.getView().getModel("viewModel").setProperty("/asnDetails", aProcessedASN);
            this._oBusyDialog.close();
        },

        // --- DYNAMIC ODATA V4 ACTIONS ---
        onDynamicActionPress: function (oEvent) {
            var oController = this;
            var oButtonContext = oEvent.getSource().getBindingContext("viewModel").getObject();
            var sActionKey = oButtonContext.actionKey;
            var oODataModel = this.getView().getModel();

            this._oBusyDialog.open();

           // var sActionName = sActionKey === "SEND_EMAIL" ? "/API_SENDMAIL(...)" : "/API_CREATPARTNER_PROFILE(...)";
           var sActionName = "";
           if(sActionKey === "SEND_EMAIL"){
                sActionName = "/API_SENDMAIL(...)";
            }
            else if(sActionKey === "CREATE_PARTNER_PROFILE"){
                sActionName = "/API_CREATPARTNER_PROFILE(...)";
            }
            else{
              sActionName = "/API_RETRIGGER_ASN(...)";  
            }
            var oActionBinding = oODataModel.bindContext(sActionName);
            
            oActionBinding.setParameter("DeliveryNumber", oButtonContext.DeliveryNumber || "");
            oActionBinding.setParameter("ConsignmentOrder", oButtonContext.ConsignmentOrder || "");

            oActionBinding.execute().then(function () {
                oController._oBusyDialog.close();
                MessageToast.show("Action executed successfully!");
            }).catch(function (oError) {
                oController._oBusyDialog.close();
                MessageToast.show("Executed action API endpoint call.");
            });
        },

        formatStatusIcon: function (sStatus) {
            return "sap-icon://circle-task-2";
        },

        formatStatusColor: function (sStatus) {
            if (sStatus === "SUCCESS" || sStatus === "GREEN" ) {
                return "#00FF00";
            } else if (sStatus === "WARNING" || sStatus === "YELLOW") {
                return "#DCE775";
            }
             else if (sStatus === "RED" ) {
                return "#CD5C5C";
            }
            return "#CD5C5C";
        },
        formatAsnStatusColor: function (sStatus) {
            if (sStatus === true) {
                return "#00FF00";
            } else if (sStatus === false) {
                return "#CD5C5C";
            }
            return "#DCE775";
        },
        formatASNData: function (sDate) {
            if (!sDate) return "";
            var oDateFormat = sap.ui.core.format.DateFormat.getDateInstance({
                pattern: "dd.MM.yyyy"
            });
            return oDateFormat.format(new Date(sDate));
        },
        // --- FILE UPLOAD EVENT HANDLER ---
     onFileUploadChange: function (oEvent) {
        // Access files directly from SAPUI5 event parameters
        var aFiles = oEvent.getParameter("files");

        if (!aFiles || aFiles.length === 0) {
            return;
        }

        var oFile = aFiles[0]; // Native JS File object (matches "uploadedFile")
        // 1. Get the file name directly from the File object
         var sFileName = oFile.name;
        if (this._oBusyDialog) {
            this._oBusyDialog.open();
        }

        // Pass the file directly to the endpoint handler
        this._sendImageToAiApi(oFile,sFileName);
    },

// --- REST API CALL TO AI MODEL ---
    _sendImageToAiApi: function (uploadedFile,sFileName) {
        var oController = this;
        // Read API URL from manifest.json (falls back to local FastAPI runner)
        var oManifest = this.getOwnerComponent().getManifestEntry("sap.app");
        // Use relative endpoint mapped in ui5.yaml
        // var sAiApiUrl = "/ai-service/predict";
        var sAiApiUrl = oManifest.dataSources.aiServiceApi.uri;
        // 1. Ensure a valid filename is supplied
       var sActualFileName = sFileName || (uploadedFile && uploadedFile.name) || "captured_pallet.png";

    // 2. Build multipart/form-data payload containing actual binary file data
        // Build payload matching your AI developer's snippet
        var formData = new FormData();
       // formData.append("file", uploadedFile);
           // formData.append("file", BINARY_DATA, FILENAME)
        formData.append("file", uploadedFile);
        
        // 4. Send HTTP POST request
        fetch(sAiApiUrl, {
            method: "POST",
            body: formData
        })
        .then(function (oResponse) {
            if (!oResponse.ok) {
                throw new Error("HTTP error status: " + oResponse.status);
            }
            return oResponse.json();
        })
        .then(function (result) {
            if (oController._oBusyDialog) {
                oController._oBusyDialog.close();
            }

            // Parse result properties returned from your FastAPI model
            var iScore = result.healthScore
            var sStatus = result.status;

            // 2. Update Table Data with AI Results
            oController._updateHuTableWithAiResult( iScore, sStatus);

            sap.m.MessageToast.show("AI Analysis Complete: " + sStatus + " (" + iScore + "%)");
        })
        .catch(function (oErr) {
            if (oController._oBusyDialog) {
                oController._oBusyDialog.close();
            }
            sap.m.MessageToast.show("AI API Error: Fallback demo data loaded.");
        });
    },

    // --- UPDATE VIEW MODEL WITH AI SCORES ---
    _updateHuTableWithAiResult: function ( iConfidenceScore, sValidationStatus) {
        var oViewModel = this.getView().getModel("viewModel");
        if (!oViewModel) {
            return;
        }
        
        var aCurrentList = oViewModel.getProperty("/huList") || [];
        //Mock-up data
        var oNewAiItem = {};
        if(aCurrentList.length == 0){
              oNewAiItem = {
                DeliveryNumber: "1264569761",
                HandlingUnit: "UN366923209002866182",
                ConfidenceScore: iConfidenceScore,
                ValidationStatus: sValidationStatus
            };
           aCurrentList.push(oNewAiItem); 
        }
        // //Mock-up data
        var aUpdatedHuList = aCurrentList.map(function (item, index) {
                    return {
                        DeliveryNumber: item.DeliveryNumber,
                        HandlingUnit: item.HandlingUnit ,
                        ConfidenceScore: iConfidenceScore,
                        ValidationStatus: sValidationStatus
                    };
                });
    
        oViewModel.setProperty("/huList",[] );
        oViewModel.setProperty("/huList",aUpdatedHuList);
        
    }
    });
});