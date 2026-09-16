import { Router } from "express";
import * as ctrl from "../controllers/file.controller.js";
import { verifyToken } from "../middleware/auth.js";
import { scopeToOrg } from "../middleware/orgScope.js";
import { upload } from "../middleware/upload.js";

const router = Router();
router.use(verifyToken, scopeToOrg);

// Generic authenticated upload — any signed-in user of the org. The consuming
// module (documents, recruitment, disciplinary) enforces its own write
// permission when it records the returned URL.
router.post("/", upload, ctrl.upload);
router.get("/:id", ctrl.download);

export default router;
