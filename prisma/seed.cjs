"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var client_1 = require("@prisma/client");
var prisma = new client_1.PrismaClient();
function main() {
    return __awaiter(this, void 0, void 0, function () {
        // Generate test orders before and after the AME27 budget start date.
        function getRandomDate() {
            var start = new Date('2025-01-01T00:00:00Z');
            var end = new Date('2026-12-31T23:59:59Z');
            return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
        }
        var subteams, vendors, seedRunId, users, i, user, vendor, totalCost, createdAt;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    subteams = ['AERO', 'CHS', 'SUS', 'BAT', 'ECE', 'PT'];
                    vendors = ['Vendor A', 'Vendor B', 'Vendor C', 'Vendor D'];
                    seedRunId = Date.now();
                    return [4 /*yield*/, Promise.all(subteams.map(function (subteam, index) {
                            return prisma.user.upsert({
                                where: { email: "user".concat(index, "@example.com") },
                                update: {},
                                create: {
                                    name: "User ".concat(index),
                                    email: "user".concat(index, "@example.com"),
                                    phone: null,
                                    role: client_1.Role.ENGINEER,
                                    subteam: subteam,
                                    password: "abcd"
                                },
                            });
                        }))];
                case 1:
                    users = _b.sent();
                    i = 0;
                    _b.label = 2;
                case 2:
                    if (!(i < 50)) return [3 /*break*/, 5];
                    user = users[Math.floor(Math.random() * users.length)];
                    vendor = vendors[Math.floor(Math.random() * vendors.length)];
                    totalCost = Math.floor(Math.random() * 5000) + 500;
                    createdAt = getRandomDate();
                    return [4 /*yield*/, prisma.order.create({
                            data: {
                                internalOrderId: "SEED-".concat(seedRunId, "-ORD-").concat(i),
                                name: "Order ".concat(i),
                                userId: user.id,
                                subteam: user.subteam,
                                status: client_1.OrderStatus.ARCHIVED,
                                vendor: vendor,
                                totalCost: totalCost,
                                comments: "Order ".concat(i, " comments"),
                                costBreakdown: (_a = {},
                                    _a[user.subteam] = 100,
                                    _a),
                                createdAt: createdAt,
                                carYear: 'AME' + ((createdAt.getUTCFullYear() % 100) + (createdAt.getUTCMonth() >= 5 ? 1 : 0)),
                                items: {
                                    create: [
                                        {
                                                internalItemId: "SEED-".concat(seedRunId, "-ITEM-").concat(i),
                                            name: "Item ".concat(i),
                                            partNumber: "PN-".concat(i),
                                            notes: "Notes for item ".concat(i),
                                            quantity: Math.floor(Math.random() * 10) + 1,
                                            price: totalCost,
                                            vendor: vendor,
                                            status: client_1.ItemStatus.TO_ORDER,
                                        },
                                    ],
                                },
                            },
                        })];
                case 3:
                    _b.sent();
                    _b.label = 4;
                case 4:
                    i++;
                    return [3 /*break*/, 2];
                case 5:
                    console.log('Database has been seeded with orders across time. 🌱');
                    return [2 /*return*/];
            }
        });
    });
}
main()
    .catch(function (e) {
    console.error(e);
    process.exit(1);
})
    .finally(function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, prisma.$disconnect()];
            case 1:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); });
