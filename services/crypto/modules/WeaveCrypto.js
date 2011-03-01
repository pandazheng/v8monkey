/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is mozilla.org code.
 *
 * The Initial Developer of the Original Code is Mozilla Foundation.
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *  Justin Dolske <dolske@mozilla.com> (original author)
 *  Richard Newman <rnewman@mozilla.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const EXPORTED_SYMBOLS = ["WeaveCrypto"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");
Components.utils.import("resource://gre/modules/ctypes.jsm");

function WeaveCrypto() {
    this.init();
}

WeaveCrypto.prototype = {
    QueryInterface: XPCOMUtils.generateQI([Ci.IWeaveCrypto]),

    prefBranch : null,
    debug      : true,  // services.sync.log.cryptoDebug
    nss        : null,
    nss_t      : null,

    observer : {
        _self : null,

        QueryInterface : XPCOMUtils.generateQI([Ci.nsIObserver,
                                                Ci.nsISupportsWeakReference]),

        observe : function (subject, topic, data) {
            let self = this._self;
            self.log("Observed " + topic + " topic.");
            if (topic == "nsPref:changed") {
                self.debug = self.prefBranch.getBoolPref("cryptoDebug");
            }
        }
    },

    init : function() {
        try {
            // Preferences. Add observer so we get notified of changes.
            this.prefBranch = Services.prefs.getBranch("services.sync.log.");
            this.prefBranch.QueryInterface(Ci.nsIPrefBranch2);
            this.prefBranch.addObserver("cryptoDebug", this.observer, false);
            this.observer._self = this;
            this.debug = this.prefBranch.getBoolPref("cryptoDebug");

            this.initNSS();
        } catch (e) {
            this.log("init failed: " + e);
            throw e;
        }
    },

    log : function (message) {
        if (!this.debug)
            return;
        dump("WeaveCrypto: " + message + "\n");
        Services.console.logStringMessage("WeaveCrypto: " + message);
    },

    initNSS : function() {
        // We use NSS for the crypto ops, which needs to be initialized before
        // use. By convention, PSM is required to be the module that
        // initializes NSS. So, make sure PSM is initialized in order to
        // implicitly initialize NSS.
        Cc["@mozilla.org/psm;1"].getService(Ci.nsISupports);

        // Open the NSS library.
        let path = ctypes.libraryName("nss3");

        // XXX really want to be able to pass specific dlopen flags here.
        var nsslib;
        try {
            this.log("Trying NSS library without path");
            nsslib = ctypes.open(path);
        } catch(e) {
            // In case opening the library without a full path fails,
            // try again with a full path.
            let file = Services.dirsvc.get("GreD", Ci.nsILocalFile);
            file.append(path);
            this.log("Trying again with path " + file.path);
            nsslib = ctypes.open(file.path);
        }

        this.log("Initializing NSS types and function declarations...");

        this.nss = {};
        this.nss_t = {};

        // nsprpub/pr/include/prtypes.h#435
        // typedef PRIntn PRBool; --> int
        this.nss_t.PRBool = ctypes.int;
        // security/nss/lib/util/seccomon.h#91
        // typedef enum
        this.nss_t.SECStatus = ctypes.int;
        // security/nss/lib/softoken/secmodt.h#59
        // typedef struct PK11SlotInfoStr PK11SlotInfo; (defined in secmodti.h) 
        this.nss_t.PK11SlotInfo = ctypes.void_t;
        // security/nss/lib/util/pkcs11t.h
        this.nss_t.CK_MECHANISM_TYPE = ctypes.unsigned_long;
        this.nss_t.CK_ATTRIBUTE_TYPE = ctypes.unsigned_long;
        this.nss_t.CK_KEY_TYPE       = ctypes.unsigned_long;
        this.nss_t.CK_OBJECT_HANDLE  = ctypes.unsigned_long;
        // security/nss/lib/softoken/secmodt.h#359
        // typedef enum PK11Origin
        this.nss_t.PK11Origin = ctypes.int;
        // PK11Origin enum values...
        this.nss.PK11_OriginUnwrap = 4;
        // security/nss/lib/softoken/secmodt.h#61
        // typedef struct PK11SymKeyStr PK11SymKey; (defined in secmodti.h)
        this.nss_t.PK11SymKey = ctypes.void_t;
        // security/nss/lib/util/secoidt.h#454
        // typedef enum
        this.nss_t.SECOidTag = ctypes.int;
        // security/nss/lib/util/seccomon.h#64
        // typedef enum
        this.nss_t.SECItemType = ctypes.int;
        // SECItemType enum values...
        this.nss.SIBUFFER = 0;
        // security/nss/lib/softoken/secmodt.h#62 (defined in secmodti.h)
        // typedef struct PK11ContextStr PK11Context;
        this.nss_t.PK11Context = ctypes.void_t;
        // Needed for SECKEYPrivateKey struct def'n, but I don't think we need to actually access it.
        this.nss_t.PLArenaPool = ctypes.void_t;
        // security/nss/lib/cryptohi/keythi.h#45
        // typedef enum
        this.nss_t.KeyType = ctypes.int;
        // security/nss/lib/softoken/secmodt.h#201
        // typedef PRUint32 PK11AttrFlags;
        this.nss_t.PK11AttrFlags = ctypes.unsigned_int;
        // security/nss/lib/util/seccomon.h#83
        // typedef struct SECItemStr SECItem; --> SECItemStr defined right below it
        this.nss_t.SECItem = ctypes.StructType(
            "SECItem", [{ type: this.nss_t.SECItemType },
                        { data: ctypes.unsigned_char.ptr },
                        { len : ctypes.int }]);
        // security/nss/lib/softoken/secmodt.h#65
        // typedef struct PK11RSAGenParamsStr --> def'n on line 139
        this.nss_t.PK11RSAGenParams = ctypes.StructType(
            "PK11RSAGenParams", [{ keySizeInBits: ctypes.int },
                                 { pe : ctypes.unsigned_long }]);
        // security/nss/lib/cryptohi/keythi.h#233
        // typedef struct SECKEYPrivateKeyStr SECKEYPrivateKey; --> def'n right above it
        this.nss_t.SECKEYPrivateKey = ctypes.StructType(
            "SECKEYPrivateKey", [{ arena:        this.nss_t.PLArenaPool.ptr  },
                                 { keyType:      this.nss_t.KeyType          },
                                 { pkcs11Slot:   this.nss_t.PK11SlotInfo.ptr },
                                 { pkcs11ID:     this.nss_t.CK_OBJECT_HANDLE },
                                 { pkcs11IsTemp: this.nss_t.PRBool           },
                                 { wincx:        ctypes.voidptr_t            },
                                 { staticflags:  ctypes.unsigned_int         }]);
        // security/nss/lib/cryptohi/keythi.h#78
        // typedef struct SECKEYRSAPublicKeyStr --> def'n right above it
        this.nss_t.SECKEYRSAPublicKey = ctypes.StructType(
            "SECKEYRSAPublicKey", [{ arena:          this.nss_t.PLArenaPool.ptr },
                                   { modulus:        this.nss_t.SECItem         },
                                   { publicExponent: this.nss_t.SECItem         }]);
        // security/nss/lib/cryptohi/keythi.h#189
        // typedef struct SECKEYPublicKeyStr SECKEYPublicKey; --> def'n right above it
        this.nss_t.SECKEYPublicKey = ctypes.StructType(
            "SECKEYPublicKey", [{ arena:      this.nss_t.PLArenaPool.ptr    },
                                { keyType:    this.nss_t.KeyType            },
                                { pkcs11Slot: this.nss_t.PK11SlotInfo.ptr   },
                                { pkcs11ID:   this.nss_t.CK_OBJECT_HANDLE   },
                                { rsa:        this.nss_t.SECKEYRSAPublicKey } ]);
                                // XXX: "rsa" et al into a union here!
                                // { dsa: SECKEYDSAPublicKey },
                                // { dh:  SECKEYDHPublicKey },
                                // { kea: SECKEYKEAPublicKey },
                                // { fortezza: SECKEYFortezzaPublicKey },
                                // { ec:  SECKEYECPublicKey } ]);
        // security/nss/lib/util/secoidt.h#52
        // typedef struct SECAlgorithmIDStr --> def'n right below it
        this.nss_t.SECAlgorithmID = ctypes.StructType(
            "SECAlgorithmID", [{ algorithm:  this.nss_t.SECItem },
                               { parameters: this.nss_t.SECItem }]);
        // security/nss/lib/certdb/certt.h#98
        // typedef struct CERTSubjectPublicKeyInfoStrA --> def'n on line 160
        this.nss_t.CERTSubjectPublicKeyInfo = ctypes.StructType(
            "CERTSubjectPublicKeyInfo", [{ arena:            this.nss_t.PLArenaPool.ptr },
                                         { algorithm:        this.nss_t.SECAlgorithmID  },
                                         { subjectPublicKey: this.nss_t.SECItem         }]);


        // security/nss/lib/util/pkcs11t.h
        this.nss.CKK_RSA = 0x0;
        this.nss.CKM_RSA_PKCS_KEY_PAIR_GEN = 0x0000;
        this.nss.CKM_AES_KEY_GEN           = 0x1080; 
        this.nss.CKA_ENCRYPT = 0x104;
        this.nss.CKA_DECRYPT = 0x105;
        this.nss.CKA_UNWRAP  = 0x107;

        // security/nss/lib/softoken/secmodt.h
        this.nss.PK11_ATTR_SESSION   = 0x02;
        this.nss.PK11_ATTR_PUBLIC    = 0x08;
        this.nss.PK11_ATTR_SENSITIVE = 0x40;

        // security/nss/lib/util/secoidt.h
        this.nss.SEC_OID_PKCS5_PBKDF2         = 291;
        this.nss.SEC_OID_HMAC_SHA1            = 294;
        this.nss.SEC_OID_PKCS1_RSA_ENCRYPTION = 16;


        // security/nss/lib/pk11wrap/pk11pub.h#286
        // SECStatus PK11_GenerateRandom(unsigned char *data,int len);
        this.nss.PK11_GenerateRandom = nsslib.declare("PK11_GenerateRandom",
                                                      ctypes.default_abi, this.nss_t.SECStatus,
                                                      ctypes.unsigned_char.ptr, ctypes.int);
        // security/nss/lib/pk11wrap/pk11pub.h#74
        // PK11SlotInfo *PK11_GetInternalSlot(void);
        this.nss.PK11_GetInternalSlot = nsslib.declare("PK11_GetInternalSlot",
                                                       ctypes.default_abi, this.nss_t.PK11SlotInfo.ptr);
        // security/nss/lib/pk11wrap/pk11pub.h#73
        // PK11SlotInfo *PK11_GetInternalKeySlot(void);
        this.nss.PK11_GetInternalKeySlot = nsslib.declare("PK11_GetInternalKeySlot",
                                                          ctypes.default_abi, this.nss_t.PK11SlotInfo.ptr);
        // security/nss/lib/pk11wrap/pk11pub.h#328
        // PK11SymKey *PK11_KeyGen(PK11SlotInfo *slot,CK_MECHANISM_TYPE type, SECItem *param, int keySize,void *wincx);
        this.nss.PK11_KeyGen = nsslib.declare("PK11_KeyGen",
                                              ctypes.default_abi, this.nss_t.PK11SymKey.ptr,
                                              this.nss_t.PK11SlotInfo.ptr, this.nss_t.CK_MECHANISM_TYPE,
                                              this.nss_t.SECItem.ptr, ctypes.int, ctypes.voidptr_t);
        // security/nss/lib/pk11wrap/pk11pub.h#477
        // SECStatus PK11_ExtractKeyValue(PK11SymKey *symKey);
        this.nss.PK11_ExtractKeyValue = nsslib.declare("PK11_ExtractKeyValue",
                                                       ctypes.default_abi, this.nss_t.SECStatus,
                                                       this.nss_t.PK11SymKey.ptr);
        // security/nss/lib/pk11wrap/pk11pub.h#478
        // SECItem * PK11_GetKeyData(PK11SymKey *symKey);
        this.nss.PK11_GetKeyData = nsslib.declare("PK11_GetKeyData",
                                                  ctypes.default_abi, this.nss_t.SECItem.ptr,
                                                  this.nss_t.PK11SymKey.ptr);
        // security/nss/lib/pk11wrap/pk11pub.h#278
        // CK_MECHANISM_TYPE PK11_AlgtagToMechanism(SECOidTag algTag);
        this.nss.PK11_AlgtagToMechanism = nsslib.declare("PK11_AlgtagToMechanism",
                                                         ctypes.default_abi, this.nss_t.CK_MECHANISM_TYPE,
                                                         this.nss_t.SECOidTag);
        // security/nss/lib/pk11wrap/pk11pub.h#270
        // int PK11_GetIVLength(CK_MECHANISM_TYPE type);
        this.nss.PK11_GetIVLength = nsslib.declare("PK11_GetIVLength",
                                                   ctypes.default_abi, ctypes.int,
                                                   this.nss_t.CK_MECHANISM_TYPE);
        // security/nss/lib/pk11wrap/pk11pub.h#269
        // int PK11_GetBlockSize(CK_MECHANISM_TYPE type,SECItem *params);
        this.nss.PK11_GetBlockSize = nsslib.declare("PK11_GetBlockSize",
                                                    ctypes.default_abi, ctypes.int,
                                                    this.nss_t.CK_MECHANISM_TYPE, this.nss_t.SECItem.ptr);
        // security/nss/lib/pk11wrap/pk11pub.h#293
        // CK_MECHANISM_TYPE PK11_GetPadMechanism(CK_MECHANISM_TYPE);
        this.nss.PK11_GetPadMechanism = nsslib.declare("PK11_GetPadMechanism",
                                                       ctypes.default_abi, this.nss_t.CK_MECHANISM_TYPE,
                                                       this.nss_t.CK_MECHANISM_TYPE);
        // security/nss/lib/pk11wrap/pk11pub.h#271
        // SECItem *PK11_ParamFromIV(CK_MECHANISM_TYPE type,SECItem *iv);
        this.nss.PK11_ParamFromIV = nsslib.declare("PK11_ParamFromIV",
                                                   ctypes.default_abi, this.nss_t.SECItem.ptr,
                                                   this.nss_t.CK_MECHANISM_TYPE, this.nss_t.SECItem.ptr);
        // security/nss/lib/pk11wrap/pk11pub.h#301
        // PK11SymKey *PK11_ImportSymKey(PK11SlotInfo *slot, CK_MECHANISM_TYPE type, PK11Origin origin,
        //                               CK_ATTRIBUTE_TYPE operation, SECItem *key, void *wincx);
        this.nss.PK11_ImportSymKey = nsslib.declare("PK11_ImportSymKey",
                                                    ctypes.default_abi, this.nss_t.PK11SymKey.ptr,
                                                    this.nss_t.PK11SlotInfo.ptr, this.nss_t.CK_MECHANISM_TYPE, this.nss_t.PK11Origin,
                                                    this.nss_t.CK_ATTRIBUTE_TYPE, this.nss_t.SECItem.ptr, ctypes.voidptr_t);
        // security/nss/lib/pk11wrap/pk11pub.h#672
        // PK11Context *PK11_CreateContextBySymKey(CK_MECHANISM_TYPE type, CK_ATTRIBUTE_TYPE operation,
        //                                         PK11SymKey *symKey, SECItem *param);
        this.nss.PK11_CreateContextBySymKey = nsslib.declare("PK11_CreateContextBySymKey",
                                                             ctypes.default_abi, this.nss_t.PK11Context.ptr,
                                                             this.nss_t.CK_MECHANISM_TYPE, this.nss_t.CK_ATTRIBUTE_TYPE,
                                                             this.nss_t.PK11SymKey.ptr, this.nss_t.SECItem.ptr);
        // security/nss/lib/pk11wrap/pk11pub.h#685
        // SECStatus PK11_CipherOp(PK11Context *context, unsigned char *out
        //                         int *outlen, int maxout, unsigned char *in, int inlen);
        this.nss.PK11_CipherOp = nsslib.declare("PK11_CipherOp",
                                                ctypes.default_abi, this.nss_t.SECStatus,
                                                this.nss_t.PK11Context.ptr, ctypes.unsigned_char.ptr,
                                                ctypes.int.ptr, ctypes.int, ctypes.unsigned_char.ptr, ctypes.int);
        // security/nss/lib/pk11wrap/pk11pub.h#688
        // SECStatus PK11_DigestFinal(PK11Context *context, unsigned char *data,
        //                            unsigned int *outLen, unsigned int length);
        this.nss.PK11_DigestFinal = nsslib.declare("PK11_DigestFinal",
                                                   ctypes.default_abi, this.nss_t.SECStatus,
                                                   this.nss_t.PK11Context.ptr, ctypes.unsigned_char.ptr,
                                                   ctypes.unsigned_int.ptr, ctypes.unsigned_int);
        // security/nss/lib/pk11wrap/pk11pub.h#507
        // SECKEYPrivateKey *PK11_GenerateKeyPairWithFlags(PK11SlotInfo *slot,
        //                                                 CK_MECHANISM_TYPE type, void *param, SECKEYPublicKey **pubk,
        //                                                 PK11AttrFlags attrFlags, void *wincx);
        this.nss.PK11_GenerateKeyPairWithFlags = nsslib.declare("PK11_GenerateKeyPairWithFlags",
                                                   ctypes.default_abi, this.nss_t.SECKEYPrivateKey.ptr,
                                                   this.nss_t.PK11SlotInfo.ptr, this.nss_t.CK_MECHANISM_TYPE, ctypes.voidptr_t,
                                                   this.nss_t.SECKEYPublicKey.ptr.ptr, this.nss_t.PK11AttrFlags, ctypes.voidptr_t);
        // security/nss/lib/pk11wrap/pk11pub.h#466
        // SECStatus PK11_SetPrivateKeyNickname(SECKEYPrivateKey *privKey, const char *nickname);
        this.nss.PK11_SetPrivateKeyNickname = nsslib.declare("PK11_SetPrivateKeyNickname",
                                                             ctypes.default_abi, this.nss_t.SECStatus,
                                                             this.nss_t.SECKEYPrivateKey.ptr, ctypes.char.ptr);
        // security/nss/lib/pk11wrap/pk11pub.h#731
        // SECAlgorithmID * PK11_CreatePBEV2AlgorithmID(SECOidTag pbeAlgTag, SECOidTag cipherAlgTag,
        //                                              SECOidTag prfAlgTag, int keyLength, int iteration,
        //                                              SECItem *salt);
        this.nss.PK11_CreatePBEV2AlgorithmID = nsslib.declare("PK11_CreatePBEV2AlgorithmID",
                                                              ctypes.default_abi, this.nss_t.SECAlgorithmID.ptr,
                                                              this.nss_t.SECOidTag, this.nss_t.SECOidTag, this.nss_t.SECOidTag, 
                                                              ctypes.int, ctypes.int, this.nss_t.SECItem.ptr);
        // security/nss/lib/pk11wrap/pk11pub.h#736
        // PK11SymKey * PK11_PBEKeyGen(PK11SlotInfo *slot, SECAlgorithmID *algid,  SECItem *pwitem, PRBool faulty3DES, void *wincx);
        this.nss.PK11_PBEKeyGen = nsslib.declare("PK11_PBEKeyGen",
                                                 ctypes.default_abi, this.nss_t.PK11SymKey.ptr,
                                                 this.nss_t.PK11SlotInfo.ptr, this.nss_t.SECAlgorithmID.ptr,
                                                 this.nss_t.SECItem.ptr, this.nss_t.PRBool, ctypes.voidptr_t);
        // security/nss/lib/pk11wrap/pk11pub.h#574
        // SECStatus PK11_WrapPrivKey(PK11SlotInfo *slot, PK11SymKey *wrappingKey,
        //                            SECKEYPrivateKey *privKey, CK_MECHANISM_TYPE wrapType,
        //                            SECItem *param, SECItem *wrappedKey, void *wincx);
        this.nss.PK11_WrapPrivKey = nsslib.declare("PK11_WrapPrivKey",
                                                   ctypes.default_abi, this.nss_t.SECStatus,
                                                   this.nss_t.PK11SlotInfo.ptr, this.nss_t.PK11SymKey.ptr,
                                                   this.nss_t.SECKEYPrivateKey.ptr, this.nss_t.CK_MECHANISM_TYPE,
                                                   this.nss_t.SECItem.ptr, this.nss_t.SECItem.ptr, ctypes.voidptr_t);
        // security/nss/lib/cryptohi/keyhi.h#159
        // SECItem* SECKEY_EncodeDERSubjectPublicKeyInfo(SECKEYPublicKey *pubk);
        this.nss.SECKEY_EncodeDERSubjectPublicKeyInfo = nsslib.declare("SECKEY_EncodeDERSubjectPublicKeyInfo",
                                                                       ctypes.default_abi, this.nss_t.SECItem.ptr,
                                                                       this.nss_t.SECKEYPublicKey.ptr);
        // security/nss/lib/cryptohi/keyhi.h#165
        // CERTSubjectPublicKeyInfo * SECKEY_DecodeDERSubjectPublicKeyInfo(SECItem *spkider);
        this.nss.SECKEY_DecodeDERSubjectPublicKeyInfo = nsslib.declare("SECKEY_DecodeDERSubjectPublicKeyInfo",
                                                                       ctypes.default_abi, this.nss_t.CERTSubjectPublicKeyInfo.ptr,
                                                                       this.nss_t.SECItem.ptr);
        // security/nss/lib/cryptohi/keyhi.h#179
        // SECKEYPublicKey * SECKEY_ExtractPublicKey(CERTSubjectPublicKeyInfo *);
        this.nss.SECKEY_ExtractPublicKey = nsslib.declare("SECKEY_ExtractPublicKey",
                                                          ctypes.default_abi, this.nss_t.SECKEYPublicKey.ptr,
                                                          this.nss_t.CERTSubjectPublicKeyInfo.ptr);
        // security/nss/lib/pk11wrap/pk11pub.h#377
        // SECStatus PK11_PubWrapSymKey(CK_MECHANISM_TYPE type, SECKEYPublicKey *pubKey,
        //                              PK11SymKey *symKey, SECItem *wrappedKey);
        this.nss.PK11_PubWrapSymKey = nsslib.declare("PK11_PubWrapSymKey",
                                                     ctypes.default_abi, this.nss_t.SECStatus,
                                                     this.nss_t.CK_MECHANISM_TYPE, this.nss_t.SECKEYPublicKey.ptr,
                                                     this.nss_t.PK11SymKey.ptr, this.nss_t.SECItem.ptr);
        // security/nss/lib/pk11wrap/pk11pub.h#568
        // SECKEYPrivateKey *PK11_UnwrapPrivKey(PK11SlotInfo *slot, 
        //                 PK11SymKey *wrappingKey, CK_MECHANISM_TYPE wrapType,
        //                 SECItem *param, SECItem *wrappedKey, SECItem *label, 
        //                 SECItem *publicValue, PRBool token, PRBool sensitive,
        //                 CK_KEY_TYPE keyType, CK_ATTRIBUTE_TYPE *usage, int usageCount,
        //                 void *wincx);
        this.nss.PK11_UnwrapPrivKey = nsslib.declare("PK11_UnwrapPrivKey",
                                                     ctypes.default_abi, this.nss_t.SECKEYPrivateKey.ptr,
                                                     this.nss_t.PK11SlotInfo.ptr, this.nss_t.PK11SymKey.ptr,
                                                     this.nss_t.CK_MECHANISM_TYPE, this.nss_t.SECItem.ptr,
                                                     this.nss_t.SECItem.ptr, this.nss_t.SECItem.ptr,
                                                     this.nss_t.SECItem.ptr, this.nss_t.PRBool,
                                                     this.nss_t.PRBool, this.nss_t.CK_KEY_TYPE,
                                                     this.nss_t.CK_ATTRIBUTE_TYPE.ptr, ctypes.int,
                                                     ctypes.voidptr_t);
        // security/nss/lib/pk11wrap/pk11pub.h#447
        // PK11SymKey *PK11_PubUnwrapSymKey(SECKEYPrivateKey *key, SECItem *wrapppedKey,
        //         CK_MECHANISM_TYPE target, CK_ATTRIBUTE_TYPE operation, int keySize);
        this.nss.PK11_PubUnwrapSymKey = nsslib.declare("PK11_PubUnwrapSymKey",
                                                       ctypes.default_abi, this.nss_t.PK11SymKey.ptr,
                                                       this.nss_t.SECKEYPrivateKey.ptr, this.nss_t.SECItem.ptr,
                                                       this.nss_t.CK_MECHANISM_TYPE, this.nss_t.CK_ATTRIBUTE_TYPE, ctypes.int);
        // security/nss/lib/pk11wrap/pk11pub.h#675
        // void PK11_DestroyContext(PK11Context *context, PRBool freeit);
        this.nss.PK11_DestroyContext = nsslib.declare("PK11_DestroyContext",
                                                       ctypes.default_abi, ctypes.void_t,
                                                       this.nss_t.PK11Context.ptr, this.nss_t.PRBool);
        // security/nss/lib/pk11wrap/pk11pub.h#299
        // void PK11_FreeSymKey(PK11SymKey *key);
        this.nss.PK11_FreeSymKey = nsslib.declare("PK11_FreeSymKey",
                                                  ctypes.default_abi, ctypes.void_t,
                                                  this.nss_t.PK11SymKey.ptr);
        // security/nss/lib/pk11wrap/pk11pub.h#70
        // void PK11_FreeSlot(PK11SlotInfo *slot);
        this.nss.PK11_FreeSlot = nsslib.declare("PK11_FreeSlot",
                                                ctypes.default_abi, ctypes.void_t,
                                                this.nss_t.PK11SlotInfo.ptr);
        // security/nss/lib/util/secitem.h#49
        // extern SECItem *SECITEM_AllocItem(PRArenaPool *arena, SECItem *item, unsigned int len);
        this.nss.SECITEM_AllocItem = nsslib.declare("SECITEM_AllocItem",
                                                    ctypes.default_abi, this.nss_t.SECItem.ptr,
                                                    this.nss_t.PLArenaPool.ptr,     // Not used.
                                                    this.nss_t.SECItem.ptr, ctypes.unsigned_int);
        // security/nss/lib/util/secitem.h#274
        // extern void SECITEM_ZfreeItem(SECItem *zap, PRBool freeit);
        this.nss.SECITEM_ZfreeItem = nsslib.declare("SECITEM_ZfreeItem",
                                                    ctypes.default_abi, ctypes.void_t,
                                                    this.nss_t.SECItem.ptr, this.nss_t.PRBool);
        // security/nss/lib/util/secitem.h#114
        // extern void SECITEM_FreeItem(SECItem *zap, PRBool freeit);
        this.nss.SECITEM_FreeItem = nsslib.declare("SECITEM_FreeItem",
                                                   ctypes.default_abi, ctypes.void_t,
                                                   this.nss_t.SECItem.ptr, this.nss_t.PRBool);
        // security/nss/lib/cryptohi/keyhi.h#193
        // extern void SECKEY_DestroyPublicKey(SECKEYPublicKey *key);
        this.nss.SECKEY_DestroyPublicKey = nsslib.declare("SECKEY_DestroyPublicKey",
                                                          ctypes.default_abi, ctypes.void_t,
                                                          this.nss_t.SECKEYPublicKey.ptr);
        // security/nss/lib/cryptohi/keyhi.h#186
        // extern void SECKEY_DestroyPrivateKey(SECKEYPrivateKey *key);
        this.nss.SECKEY_DestroyPrivateKey = nsslib.declare("SECKEY_DestroyPrivateKey",
                                                           ctypes.default_abi, ctypes.void_t,
                                                           this.nss_t.SECKEYPrivateKey.ptr);
        // security/nss/lib/util/secoid.h#103
        // extern void SECOID_DestroyAlgorithmID(SECAlgorithmID *aid, PRBool freeit);
        this.nss.SECOID_DestroyAlgorithmID = nsslib.declare("SECOID_DestroyAlgorithmID",
                                                            ctypes.default_abi, ctypes.void_t,
                                                            this.nss_t.SECAlgorithmID.ptr, this.nss_t.PRBool);
        // security/nss/lib/cryptohi/keyhi.h#58
        // extern void SECKEY_DestroySubjectPublicKeyInfo(CERTSubjectPublicKeyInfo *spki);
        this.nss.SECKEY_DestroySubjectPublicKeyInfo = nsslib.declare("SECKEY_DestroySubjectPublicKeyInfo",
                                                                     ctypes.default_abi, ctypes.void_t,
                                                                     this.nss_t.CERTSubjectPublicKeyInfo.ptr);
    },


    //
    // IWeaveCrypto interfaces
    //


    algorithm : Ci.IWeaveCrypto.AES_256_CBC,

    encrypt : function(clearTextUCS2, symmetricKey, iv) {
        this.log("encrypt() called");

        // js-ctypes autoconverts to a UTF8 buffer, but also includes a null
        // at the end which we don't want. Cast to make the length 1 byte shorter.
        let inputBuffer = new ctypes.ArrayType(ctypes.unsigned_char)(clearTextUCS2);
        inputBuffer = ctypes.cast(inputBuffer, ctypes.unsigned_char.array(inputBuffer.length - 1));

        // When using CBC padding, the output size is the input size rounded
        // up to the nearest block. If the input size is exactly on a block
        // boundary, the output is 1 extra block long.
        let mech = this.nss.PK11_AlgtagToMechanism(this.algorithm);
        let blockSize = this.nss.PK11_GetBlockSize(mech, null);
        let outputBufferSize = inputBuffer.length + blockSize;
        let outputBuffer = new ctypes.ArrayType(ctypes.unsigned_char, outputBufferSize)();

        outputBuffer = this._commonCrypt(inputBuffer, outputBuffer, symmetricKey, iv, this.nss.CKA_ENCRYPT);

        return this.encodeBase64(outputBuffer.address(), outputBuffer.length);
    },


    decrypt : function(cipherText, symmetricKey, iv) {
        this.log("decrypt() called");

        let inputUCS2 = "";
        if (cipherText.length)
            inputUCS2 = atob(cipherText);

        // We can't have js-ctypes create the buffer directly from the string
        // (as in encrypt()), because we do _not_ want it to do UTF8
        // conversion... We've got random binary data in the input's low byte.
        let input = new ctypes.ArrayType(ctypes.unsigned_char, inputUCS2.length)();
        this.byteCompress(inputUCS2, input);

        let outputBuffer = new ctypes.ArrayType(ctypes.unsigned_char, input.length)();

        outputBuffer = this._commonCrypt(input, outputBuffer, symmetricKey, iv, this.nss.CKA_DECRYPT);

        // outputBuffer contains UTF-8 data, let js-ctypes autoconvert that to a JS string.
        // XXX Bug 573842: wrap the string from ctypes to get a new string, so
        // we don't hit bug 573841.
        return "" + outputBuffer.readString() + "";
    },


    _commonCrypt : function (input, output, symmetricKey, iv, operation) {
        this.log("_commonCrypt() called");
        // Get rid of the base64 encoding and convert to SECItems.
        let keyItem = this.makeSECItem(symmetricKey, true);
        let ivItem  = this.makeSECItem(iv, true);

        // Determine which (padded) PKCS#11 mechanism to use.
        // EG: AES_128_CBC --> CKM_AES_CBC --> CKM_AES_CBC_PAD
        let mechanism = this.nss.PK11_AlgtagToMechanism(this.algorithm);
        mechanism = this.nss.PK11_GetPadMechanism(mechanism);
        if (mechanism == this.nss.CKM_INVALID_MECHANISM)
            throw Components.Exception("invalid algorithm (can't pad)", Cr.NS_ERROR_FAILURE);

        let ctx, symKey, slot, ivParam;
        try {
            ivParam = this.nss.PK11_ParamFromIV(mechanism, ivItem);
            if (ivParam.isNull())
                throw Components.Exception("can't convert IV to param", Cr.NS_ERROR_FAILURE);

            slot = this.nss.PK11_GetInternalKeySlot();
            if (slot.isNull())
                throw Components.Exception("can't get internal key slot", Cr.NS_ERROR_FAILURE);

            symKey = this.nss.PK11_ImportSymKey(slot, mechanism, this.nss.PK11_OriginUnwrap, operation, keyItem, null);
            if (symKey.isNull())
                throw Components.Exception("symkey import failed", Cr.NS_ERROR_FAILURE);

            ctx = this.nss.PK11_CreateContextBySymKey(mechanism, operation, symKey, ivParam);
            if (ctx.isNull())
                throw Components.Exception("couldn't create context for symkey", Cr.NS_ERROR_FAILURE);

            let maxOutputSize = output.length;
            let tmpOutputSize = new ctypes.int(); // Note 1: NSS uses a signed int here...

            if (this.nss.PK11_CipherOp(ctx, output, tmpOutputSize.address(), maxOutputSize, input, input.length))
                throw Components.Exception("cipher operation failed", Cr.NS_ERROR_FAILURE);

            let actualOutputSize = tmpOutputSize.value;
            let finalOutput = output.addressOfElement(actualOutputSize);
            maxOutputSize -= actualOutputSize;

            // PK11_DigestFinal sure sounds like the last step for *hashing*, but it
            // just seems to be an odd name -- NSS uses this to finish the current
            // cipher operation. You'd think it would be called PK11_CipherOpFinal...
            let tmpOutputSize2 = new ctypes.unsigned_int(); // Note 2: ...but an unsigned here!
            if (this.nss.PK11_DigestFinal(ctx, finalOutput, tmpOutputSize2.address(), maxOutputSize))
                throw Components.Exception("cipher finalize failed", Cr.NS_ERROR_FAILURE);

            actualOutputSize += tmpOutputSize2.value;
            let newOutput = ctypes.cast(output, ctypes.unsigned_char.array(actualOutputSize));
            return newOutput;
        } catch (e) {
            this.log("_commonCrypt: failed: " + e);
            throw e;
        } finally {
            if (ctx && !ctx.isNull())
                this.nss.PK11_DestroyContext(ctx, true);
            if (symKey && !symKey.isNull())
                this.nss.PK11_FreeSymKey(symKey);
            if (slot && !slot.isNull())
                this.nss.PK11_FreeSlot(slot);
            if (ivParam && !ivParam.isNull())
                this.nss.SECITEM_FreeItem(ivParam, true);
            this.freeSECItem(keyItem);
            this.freeSECItem(ivItem);
        }
    },


    generateRandomKey : function() {
        this.log("generateRandomKey() called");
        let encodedKey, keygenMech, keySize;

        // Doesn't NSS have a lookup function to do this?
        switch(this.algorithm) {
          case Ci.IWeaveCrypto.AES_128_CBC:
            keygenMech = this.nss.CKM_AES_KEY_GEN;
            keySize = 16;
            break;

          case Ci.IWeaveCrypto.AES_192_CBC:
            keygenMech = this.nss.CKM_AES_KEY_GEN;
            keySize = 24;
            break;

          case Ci.IWeaveCrypto.AES_256_CBC:
            keygenMech = this.nss.CKM_AES_KEY_GEN;
            keySize = 32;
            break;

          default:
            throw Components.Exception("unknown algorithm", Cr.NS_ERROR_FAILURE);
        }

        let slot, randKey, keydata;
        try {
            slot = this.nss.PK11_GetInternalSlot();
            if (slot.isNull())
                throw Components.Exception("couldn't get internal slot", Cr.NS_ERROR_FAILURE);

            randKey = this.nss.PK11_KeyGen(slot, keygenMech, null, keySize, null);
            if (randKey.isNull())
                throw Components.Exception("PK11_KeyGen failed.", Cr.NS_ERROR_FAILURE);

            // Slightly odd API, this call just prepares the key value for
            // extraction, we get the actual bits from the call to PK11_GetKeyData().
            if (this.nss.PK11_ExtractKeyValue(randKey))
                throw Components.Exception("PK11_ExtractKeyValue failed.", Cr.NS_ERROR_FAILURE);

            keydata = this.nss.PK11_GetKeyData(randKey);
            if (keydata.isNull())
                throw Components.Exception("PK11_GetKeyData failed.", Cr.NS_ERROR_FAILURE);

            return this.encodeBase64(keydata.contents.data, keydata.contents.len);
        } catch (e) {
            this.log("generateRandomKey: failed: " + e);
            throw e;
        } finally {
            if (randKey && !randKey.isNull())
                this.nss.PK11_FreeSymKey(randKey);
            if (slot && !slot.isNull())
                this.nss.PK11_FreeSlot(slot);
        }
    },


    generateRandomIV : function() {
        this.log("generateRandomIV() called");

        let mech = this.nss.PK11_AlgtagToMechanism(this.algorithm);
        let size = this.nss.PK11_GetIVLength(mech);

        return this.generateRandomBytes(size);
    },


    generateRandomBytes : function(byteCount) {
        this.log("generateRandomBytes() called");

        // Temporary buffer to hold the generated data.
        let scratch = new ctypes.ArrayType(ctypes.unsigned_char, byteCount)();
        if (this.nss.PK11_GenerateRandom(scratch, byteCount))
            throw Components.Exception("PK11_GenrateRandom failed", Cr.NS_ERROR_FAILURE);

        return this.encodeBase64(scratch.address(), scratch.length);
    },


    //
    // Utility functions
    //


    // Compress a JS string (2-byte chars) into a normal C string (1-byte chars)
    // EG, for "ABC",  0x0041, 0x0042, 0x0043 --> 0x41, 0x42, 0x43
    byteCompress : function (jsString, charArray) {
        let intArray = ctypes.cast(charArray, ctypes.uint8_t.array(charArray.length));
        for (let i = 0; i < jsString.length; i++)
            intArray[i] = jsString.charCodeAt(i) % 256; // convert to bytes
    },

    // Expand a normal C string (1-byte chars) into a JS string (2-byte chars)
    // EG, for "ABC",  0x41, 0x42, 0x43 --> 0x0041, 0x0042, 0x0043
    byteExpand : function (charArray) {
        let expanded = "";
        let len = charArray.length;
        let intData = ctypes.cast(charArray, ctypes.uint8_t.array(len));
        for (let i = 0; i < len; i++)
            expanded += String.fromCharCode(intData[i]);
        return expanded;
    },

    expandData : function expandData(data, len) {
        // Byte-expand the buffer, so we can treat it as a UCS-2 string
        // consisting of u0000 - u00FF.
        let expanded = "";
        let intData = ctypes.cast(data, ctypes.uint8_t.array(len).ptr).contents;
        for (let i = 0; i < len; i++)
            expanded += String.fromCharCode(intData[i]);
      return expanded;
    },

    encodeBase64 : function (data, len) {
        return btoa(this.expandData(data, len));
    },

    // Returns a filled SECItem *, as returned by SECITEM_AllocItem.
    // 
    // Note that this must be released with freeSECItem, which will also
    // deallocate the internal buffer.
    makeSECItem : function(input, isEncoded) {
        if (isEncoded)
            input = atob(input);
        
        let len = input.length;
        let item = this.nss.SECITEM_AllocItem(null, null, len);
        if (item.isNull())
          throw "SECITEM_AllocItem failed.";
        
        let dest = ctypes.cast(item.contents.data, ctypes.unsigned_char.array(len).ptr);
        this.byteCompress(input, dest.contents);
        return item;
    },
    
    freeSECItem : function(zap) {
        if (zap && !zap.isNull())
            this.nss.SECITEM_ZfreeItem(zap, true);
    },

    /**
     * Returns the expanded data string for the derived key.
     */
    deriveKeyFromPassphrase : function deriveKeyFromPassphrase(passphrase, salt, keyLength) {
        this.log("deriveKeyFromPassphrase() called.");
        let passItem = this.makeSECItem(passphrase, false);
        let saltItem = this.makeSECItem(salt, true);

        let pbeAlg = this.algorithm;
        let cipherAlg = this.algorithm; // ignored by callee when pbeAlg != a pkcs5 mech.
        let prfAlg = this.nss.SEC_OID_HMAC_SHA1; // callee picks if SEC_OID_UNKNOWN, but only SHA1 is supported

        let keyLength  = keyLength || 0;    // 0 = Callee will pick.
        let iterations = 4096; // PKCS#5 recommends at least 1000.

        let algid, slot, symKey, keyData;
        try {
            algid = this.nss.PK11_CreatePBEV2AlgorithmID(pbeAlg, cipherAlg, prfAlg,
                                                         keyLength, iterations, 
                                                         saltItem);
            if (algid.isNull())
                throw Components.Exception("PK11_CreatePBEV2AlgorithmID failed", Cr.NS_ERROR_FAILURE);

            slot = this.nss.PK11_GetInternalSlot();
            if (slot.isNull())
                throw Components.Exception("couldn't get internal slot", Cr.NS_ERROR_FAILURE);

            symKey = this.nss.PK11_PBEKeyGen(slot, algid, passItem, false, null);
            if (symKey.isNull())
                throw Components.Exception("PK11_PBEKeyGen failed", Cr.NS_ERROR_FAILURE);

            // Take the PK11SymKeyStr, returning the extracted key data.
            if (this.nss.PK11_ExtractKeyValue(symKey)) {
                throw this.makeException("PK11_ExtractKeyValue failed.", Cr.NS_ERROR_FAILURE);
            }

            keyData = this.nss.PK11_GetKeyData(symKey);

            if (keyData.isNull())
                throw Components.Exception("PK11_GetKeyData failed", Cr.NS_ERROR_FAILURE);

            // This copies the key contents into a JS string, so we don't leak.
            // The `finally` block below will clean up.
            return this.expandData(keyData.contents.data, keyData.contents.len);

        } catch (e) {
            this.log("deriveKeyFromPassphrase: failed: " + e);
            throw e;
        } finally {
            if (algid && !algid.isNull())
                this.nss.SECOID_DestroyAlgorithmID(algid, true);
            if (slot && !slot.isNull())
                this.nss.PK11_FreeSlot(slot);
            if (symKey && !symKey.isNull())
                this.nss.PK11_FreeSymKey(symKey);
            
            this.freeSECItem(passItem);
            this.freeSECItem(saltItem);
        }
    },
};
