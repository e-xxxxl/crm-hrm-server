import mongoose from "mongoose";
import { quickshipSourceConnection } from "../../config/externalSources.js";

/**
 * READ-ONLY mirrors of QuickShipAfrica's own production schema
 * (see C:\Users\HP\Desktop\quickShip\quickShip Backend\models).
 */
const { Schema } = mongoose;

const userSchema = new Schema(
  { firstName: String, lastName: String, email: String, phoneNumber: String, fullPhoneNumber: String, accountStatus: String, createdAt: Date },
  { strict: false, collection: "users" },
);

const shipmentSchema = new Schema(
  {
    user: Schema.Types.ObjectId,
    terminalShipmentId: String,
    trackingNumber: String,
    reference: String,
    status: String,
    sender: Schema.Types.Mixed,
    receiver: Schema.Types.Mixed,
    parcel: Schema.Types.Mixed,
    shipping: Schema.Types.Mixed,
    payment: Schema.Types.Mixed,
    createdAt: Date,
  },
  { strict: false, collection: "shipments" },
);

export const QuickShipUser = quickshipSourceConnection?.models.User || quickshipSourceConnection?.model("User", userSchema);
export const QuickShipShipment = quickshipSourceConnection?.models.Shipment || quickshipSourceConnection?.model("Shipment", shipmentSchema);

export default { QuickShipUser, QuickShipShipment };
