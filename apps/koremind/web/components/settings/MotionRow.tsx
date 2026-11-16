import { ListRow } from "@qarasky/kore-ui";
import { motion } from "motion/react";

/** A kore-ui `ListRow` that takes motion props (enter, exit, layout) inside an `AnimatePresence`. */
export const MotionRow = motion.create(ListRow);
