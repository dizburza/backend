import { Router } from "express";
import { alchemyWebhook } from "../controllers/webhooks.controller.js";

const router = Router();

router.post("/alchemy", alchemyWebhook);

export default router;
