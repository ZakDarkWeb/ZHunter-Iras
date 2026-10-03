'use strict';
const ZH_TITLE_OPTIMIZER_RULES = {
    "title_optimization":  {
                               "objective":  "Create a descriptive, professional, relevant, search-friendly Temu product title.",
                               "recommended_structure":  "Quantifier + Core Feature + Short Product Keywords + Additional Feature + Alternative Keyword + Target Market / Audience + Size / Color (if applicable) + Product Category",
                               "separator":  "Use commas between relevant keyword groups.",
                               "rules":  [
                                             "Make the title descriptive rather than unnecessarily short.",
                                             "Use relevant product keywords naturally.",
                                             "Add relevant descriptive details when they can be accurately derived from the original title.",
                                             "Retain important product details such as brand, product type, flavor, color, size, quantity, pack count, and other explicitly provided specifications.",
                                             "Improve wording, structure, readability, and keyword coverage.",
                                             "Do not use keyword stuffing.",
                                             "Do not repeat keywords unnecessarily.",
                                             "Do not add irrelevant keywords.",
                                             "Do not invent product specifications or features.",
                                             "Do not invent materials, functions, certifications, benefits, sizes, colors, quantities, or intended uses.",
                                             "Do not make the title unnecessarily short simply because certain claims are restricted."
                                         ]
                           },
    "restricted_content":  {
                               "instruction":  "Avoid unsupported or unnecessary restricted claims and terminology, especially health, medical, allergy, environmental, electrical/electronic, safety, performance, and certification claims.",
                               "categories":  {
                                                  "health_medical":  [
                                                                         "medical",
                                                                         "medicine",
                                                                         "therapeutic",
                                                                         "treatment",
                                                                         "cure",
                                                                         "healing",
                                                                         "diagnosis",
                                                                         "disease",
                                                                         "illness",
                                                                         "clinical",
                                                                         "therapy",
                                                                         "pain relief",
                                                                         "anti-inflammatory",
                                                                         "infection",
                                                                         "antibacterial",
                                                                         "antiviral",
                                                                         "antifungal",
                                                                         "rehabilitation",
                                                                         "orthopedic",
                                                                         "medical-grade"
                                                                     ],
                                                  "allergy":  [
                                                                  "allergy-free",
                                                                  "allergy relief",
                                                                  "anti-allergy",
                                                                  "hypoallergenic",
                                                                  "allergen-free",
                                                                  "prevents allergies",
                                                                  "protects against allergens"
                                                              ],
                                                  "environmental":  [
                                                                        "eco-friendly",
                                                                        "environmentally friendly",
                                                                        "green",
                                                                        "sustainable",
                                                                        "biodegradable",
                                                                        "compostable",
                                                                        "recyclable",
                                                                        "carbon-neutral",
                                                                        "non-toxic",
                                                                        "chemical-free",
                                                                        "organic",
                                                                        "environmentally safe"
                                                                    ],
                                                  "electrical_electronic":  [
                                                                                "electric",
                                                                                "electronic",
                                                                                "powered",
                                                                                "rechargeable",
                                                                                "battery-powered",
                                                                                "wireless",
                                                                                "USB",
                                                                                "charging",
                                                                                "voltage",
                                                                                "current",
                                                                                "smart",
                                                                                "digital",
                                                                                "automatic",
                                                                                "sensor",
                                                                                "motor",
                                                                                "LED"
                                                                            ],
                                                  "safety_performance":  [
                                                                             "safe",
                                                                             "safer",
                                                                             "harmless",
                                                                             "guaranteed",
                                                                             "protective",
                                                                             "effective",
                                                                             "highly effective",
                                                                             "professional-grade",
                                                                             "risk-free",
                                                                             "100% safe",
                                                                             "100% effective"
                                                                         ],
                                                  "certification_authority":  [
                                                                                  "FDA approved",
                                                                                  "CE certified",
                                                                                  "certified",
                                                                                  "approved",
                                                                                  "clinically tested",
                                                                                  "laboratory tested",
                                                                                  "doctor recommended",
                                                                                  "professional recommended",
                                                                                  "official"
                                                                              ]
                                              }
                           },
    "context_rule":  {
                         "instruction":  "Do not blindly remove every word that resembles a restricted category. Determine whether it is being used as a claim or restricted characteristic. If it is unnecessary or unsupported, remove it. Replace it with a neutral factual product description when possible."
                     },
    "output_rules":  {
                         "accuracy":  "Keep explicitly provided brand, product type, flavor, size, color and pack quantity. Do not invent details to fill structure slots. Omit inapplicable groups.",
                         "format":  "Only one optimized title, no labels, explanations, bullets or quotes",
                         "length":  "120-170 characters; never exceed 180"
                     }
};