import mongoose from "mongoose";
import { hrmConnection } from "../../config/db.js";
import { registerModel } from "../registerModel.js";

const { Schema } = mongoose;

/**
 * Metadata for an uploaded file. The bytes live on disk under UPLOAD_DIR; this
 * record ties them to an organization so downloads can be access-controlled.
 */
const storedFileSchema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    key: { type: String, required: true, unique: true }, // filename on disk
    originalName: { type: String, trim: true },
    mimeType: { type: String, trim: true },
    size: { type: Number },
    purpose: { type: String, trim: true, default: "general" }, // document | resume | evidence | avatar…
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
    scanStatus: { type: String, enum: ["skipped", "pending", "clean", "infected"], default: "skipped" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

storedFileSchema.set("toJSON", {
  virtuals: true,
  transform(_d, r) {
    r.id = r._id;
    delete r._id;
    delete r.__v;
    delete r.key;
    return r;
  },
});

export const StoredFile = registerModel(hrmConnection, "StoredFile", storedFileSchema);
export default StoredFile;
