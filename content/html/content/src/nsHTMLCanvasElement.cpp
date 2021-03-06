/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
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
 * The Initial Developer of the Original Code is
 *   Vladimir Vukicevic <vladimir@pobox.com>
 * Portions created by the Initial Developer are Copyright (C) 2005
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either of the GNU General Public License Version 2 or later (the "GPL"),
 * or the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
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

#include "nsHTMLCanvasElement.h"

#include "plbase64.h"
#include "nsNetUtil.h"
#include "prmem.h"
#include "nsDOMFile.h"
#include "CheckedInt.h"

#include "nsIScriptSecurityManager.h"
#include "nsIXPConnect.h"
#include "jsapi.h"
#include "nsJSUtils.h"

#include "nsFrameManager.h"
#include "nsDisplayList.h"
#include "ImageLayers.h"
#include "BasicLayers.h"
#include "imgIEncoder.h"

#include "nsIWritablePropertyBag2.h"

#define DEFAULT_CANVAS_WIDTH 300
#define DEFAULT_CANVAS_HEIGHT 150

using namespace mozilla;
using namespace mozilla::dom;
using namespace mozilla::layers;

nsGenericHTMLElement*
NS_NewHTMLCanvasElement(already_AddRefed<nsINodeInfo> aNodeInfo,
                        FromParser aFromParser)
{
  return new nsHTMLCanvasElement(aNodeInfo);
}

nsHTMLCanvasElement::nsHTMLCanvasElement(already_AddRefed<nsINodeInfo> aNodeInfo)
  : nsGenericHTMLElement(aNodeInfo), mWriteOnly(PR_FALSE)
{
}

nsHTMLCanvasElement::~nsHTMLCanvasElement()
{
}

NS_IMPL_CYCLE_COLLECTION_CLASS(nsHTMLCanvasElement)
NS_IMPL_CYCLE_COLLECTION_TRAVERSE_BEGIN_INHERITED(nsHTMLCanvasElement,
                                                  nsGenericHTMLElement)
  NS_IMPL_CYCLE_COLLECTION_TRAVERSE_NSCOMPTR(mCurrentContext)
NS_IMPL_CYCLE_COLLECTION_TRAVERSE_END

NS_IMPL_ADDREF_INHERITED(nsHTMLCanvasElement, nsGenericElement)
NS_IMPL_RELEASE_INHERITED(nsHTMLCanvasElement, nsGenericElement)

DOMCI_NODE_DATA(HTMLCanvasElement, nsHTMLCanvasElement)

NS_INTERFACE_TABLE_HEAD_CYCLE_COLLECTION_INHERITED(nsHTMLCanvasElement)
  NS_HTML_CONTENT_INTERFACE_TABLE2(nsHTMLCanvasElement,
                                   nsIDOMHTMLCanvasElement,
                                   nsICanvasElementExternal)
  NS_HTML_CONTENT_INTERFACE_TABLE_TO_MAP_SEGUE(nsHTMLCanvasElement,
                                               nsGenericHTMLElement)
NS_HTML_CONTENT_INTERFACE_TABLE_TAIL_CLASSINFO(HTMLCanvasElement)

NS_IMPL_ELEMENT_CLONE(nsHTMLCanvasElement)

nsIntSize
nsHTMLCanvasElement::GetWidthHeight()
{
  nsIntSize size(0,0);
  const nsAttrValue* value;

  if ((value = GetParsedAttr(nsGkAtoms::width)) &&
      value->Type() == nsAttrValue::eInteger)
  {
      size.width = value->GetIntegerValue();
  }

  if ((value = GetParsedAttr(nsGkAtoms::height)) &&
      value->Type() == nsAttrValue::eInteger)
  {
      size.height = value->GetIntegerValue();
  }

  if (size.width <= 0)
    size.width = DEFAULT_CANVAS_WIDTH;
  if (size.height <= 0)
    size.height = DEFAULT_CANVAS_HEIGHT;

  return size;
}

NS_IMPL_UINT_ATTR_DEFAULT_VALUE(nsHTMLCanvasElement, Width, width, DEFAULT_CANVAS_WIDTH)
NS_IMPL_UINT_ATTR_DEFAULT_VALUE(nsHTMLCanvasElement, Height, height, DEFAULT_CANVAS_HEIGHT)
NS_IMPL_BOOL_ATTR(nsHTMLCanvasElement, MozOpaque, moz_opaque)

nsresult
nsHTMLCanvasElement::SetAttr(PRInt32 aNameSpaceID, nsIAtom* aName,
                             nsIAtom* aPrefix, const nsAString& aValue,
                             PRBool aNotify)
{
  nsresult rv = nsGenericHTMLElement::SetAttr(aNameSpaceID, aName, aPrefix, aValue,
                                              aNotify);
  if (NS_SUCCEEDED(rv) && mCurrentContext &&
      (aName == nsGkAtoms::width || aName == nsGkAtoms::height || aName == nsGkAtoms::moz_opaque))
  {
    rv = UpdateContext();
    NS_ENSURE_SUCCESS(rv, rv);
  }

  return rv;
}

nsresult
nsHTMLCanvasElement::CopyInnerTo(nsGenericElement* aDest) const
{
  nsresult rv = nsGenericHTMLElement::CopyInnerTo(aDest);
  NS_ENSURE_SUCCESS(rv, rv);
  if (aDest->GetOwnerDoc()->IsStaticDocument()) {
    nsHTMLCanvasElement* dest = static_cast<nsHTMLCanvasElement*>(aDest);
    nsCOMPtr<nsISupports> cxt;
    dest->GetContext(NS_LITERAL_STRING("2d"), JSVAL_VOID, getter_AddRefs(cxt));
    nsCOMPtr<nsIDOMCanvasRenderingContext2D> context2d = do_QueryInterface(cxt);
    if (context2d) {
      context2d->DrawImage(const_cast<nsHTMLCanvasElement*>(this),
                           0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0);
    }
  }
  return rv;
}

nsChangeHint
nsHTMLCanvasElement::GetAttributeChangeHint(const nsIAtom* aAttribute,
                                            PRInt32 aModType) const
{
  nsChangeHint retval =
    nsGenericHTMLElement::GetAttributeChangeHint(aAttribute, aModType);
  if (aAttribute == nsGkAtoms::width ||
      aAttribute == nsGkAtoms::height)
  {
    NS_UpdateHint(retval, NS_STYLE_HINT_REFLOW);
  } else if (aAttribute == nsGkAtoms::moz_opaque)
  {
    NS_UpdateHint(retval, NS_STYLE_HINT_VISUAL);
  }
  return retval;
}

PRBool
nsHTMLCanvasElement::ParseAttribute(PRInt32 aNamespaceID,
                                    nsIAtom* aAttribute,
                                    const nsAString& aValue,
                                    nsAttrValue& aResult)
{
  if (aNamespaceID == kNameSpaceID_None &&
      (aAttribute == nsGkAtoms::width || aAttribute == nsGkAtoms::height)) {
    return aResult.ParseNonNegativeIntValue(aValue);
  }

  return nsGenericHTMLElement::ParseAttribute(aNamespaceID, aAttribute, aValue,
                                              aResult);
}


// nsHTMLCanvasElement::toDataURL

NS_IMETHODIMP
nsHTMLCanvasElement::ToDataURL(const nsAString& aType, const nsAString& aParams,
                               PRUint8 optional_argc, nsAString& aDataURL)
{
  // do a trust check if this is a write-only canvas
  // or if we're trying to use the 2-arg form
  if ((mWriteOnly || optional_argc >= 2) &&
      !nsContentUtils::IsCallerTrustedForRead()) {
    return NS_ERROR_DOM_SECURITY_ERR;
  }

  return ToDataURLImpl(aType, aParams, aDataURL);
}


// nsHTMLCanvasElement::toDataURLAs
//
// Native-callers only

NS_IMETHODIMP
nsHTMLCanvasElement::ToDataURLAs(const nsAString& aMimeType,
                                 const nsAString& aEncoderOptions,
                                 nsAString& aDataURL)
{
  return ToDataURLImpl(aMimeType, aEncoderOptions, aDataURL);
}

nsresult
nsHTMLCanvasElement::ExtractData(const nsAString& aType,
                                 const nsAString& aOptions,
                                 char*& aResult,
                                 PRUint32& aSize,
                                 bool& aFellBackToPNG)
{
  // note that if we don't have a current context, the spec says we're
  // supposed to just return transparent black pixels of the canvas
  // dimensions.
  nsRefPtr<gfxImageSurface> emptyCanvas;
  nsIntSize size = GetWidthHeight();
  if (!mCurrentContext) {
    emptyCanvas = new gfxImageSurface(gfxIntSize(size.width, size.height), gfxASurface::ImageFormatARGB32);
  }

  nsresult rv;

  // get image bytes
  nsCOMPtr<nsIInputStream> imgStream;
  NS_ConvertUTF16toUTF8 encoderType(aType);

 try_again:
  if (mCurrentContext) {
    rv = mCurrentContext->GetInputStream(nsPromiseFlatCString(encoderType).get(),
                                         nsPromiseFlatString(aOptions).get(),
                                         getter_AddRefs(imgStream));
  } else {
    // no context, so we have to encode the empty image we created above
    nsCString enccid("@mozilla.org/image/encoder;2?type=");
    enccid += encoderType;

    nsCOMPtr<imgIEncoder> encoder = do_CreateInstance(nsPromiseFlatCString(enccid).get(), &rv);
    if (NS_SUCCEEDED(rv) && encoder) {
      rv = encoder->InitFromData(emptyCanvas->Data(),
                                 size.width * size.height * 4,
                                 size.width,
                                 size.height,
                                 size.width * 4,
                                 imgIEncoder::INPUT_FORMAT_HOSTARGB,
                                 aOptions);
      if (NS_SUCCEEDED(rv)) {
        imgStream = do_QueryInterface(encoder);
      }
    } else {
      rv = NS_ERROR_FAILURE;
    }
  }

  if (NS_FAILED(rv) && !aFellBackToPNG) {
    // Try image/png instead.
    // XXX ERRMSG we need to report an error to developers here! (bug 329026)
    aFellBackToPNG = true;
    encoderType.AssignLiteral("image/png");
    goto try_again;
  }

  // at this point, we either need to succeed or bail.
  NS_ENSURE_SUCCESS(rv, rv);

  // Generally, there will be only one chunk of data, and it will be available
  // for us to read right away, so optimize this case.
  PRUint32 bufSize;
  rv = imgStream->Available(&bufSize);
  CheckedUint32 safeBufSize(bufSize);
  NS_ENSURE_SUCCESS(rv, rv);

  // ...leave a little extra room so we can call read again and make sure we
  // got everything. 16 bytes for better padding (maybe)
  safeBufSize += 16;
  NS_ENSURE_TRUE(safeBufSize.valid(), NS_ERROR_FAILURE);
  aSize = 0;
  aResult = (char*)PR_Malloc(safeBufSize.value());
  if (!aResult)
    return NS_ERROR_OUT_OF_MEMORY;
  PRUint32 numReadThisTime = 0;
  while ((rv = imgStream->Read(&aResult[aSize], safeBufSize.value() - aSize,
                               &numReadThisTime)) == NS_OK &&
         numReadThisTime > 0) {
    aSize += numReadThisTime;
    if (aSize == safeBufSize.value()) {
      // need a bigger buffer, just double
      safeBufSize *= 2;
      if (!safeBufSize.valid()) {
        PR_Free(aResult);
        return NS_ERROR_FAILURE;
      }
      char* newImgData = (char*)PR_Realloc(aResult, safeBufSize.value());
      if (! newImgData) {
        PR_Free(aResult);
        return NS_ERROR_OUT_OF_MEMORY;
      }
      aResult = newImgData;
    }
  }

  return NS_OK;
}

nsresult
nsHTMLCanvasElement::ToDataURLImpl(const nsAString& aMimeType,
                                   const nsAString& aEncoderOptions,
                                   nsAString& aDataURL)
{
  bool fallbackToPNG = false;

  nsAutoString type;
  nsContentUtils::ASCIIToLower(aMimeType, type);

  PRUint32 imgSize = 0;
  char* imgData;

  nsresult rv = ExtractData(type, aEncoderOptions, imgData,
                            imgSize, fallbackToPNG);
  NS_ENSURE_SUCCESS(rv, rv);

  // base 64, result will be NULL terminated
  char* encodedImg = PL_Base64Encode(imgData, imgSize, nsnull);
  PR_Free(imgData);
  if (!encodedImg) // not sure why this would fail
    return NS_ERROR_OUT_OF_MEMORY;

  // build data URL string
  if (fallbackToPNG)
    aDataURL = NS_LITERAL_STRING("data:image/png;base64,") +
      NS_ConvertUTF8toUTF16(encodedImg);
  else
    aDataURL = NS_LITERAL_STRING("data:") + type +
      NS_LITERAL_STRING(";base64,") + NS_ConvertUTF8toUTF16(encodedImg);

  PR_Free(encodedImg);

  return NS_OK;
}

NS_IMETHODIMP
nsHTMLCanvasElement::MozGetAsFile(const nsAString& aName,
                                  const nsAString& aType,
                                  PRUint8 optional_argc,
                                  nsIDOMFile** aResult)
{
  // do a trust check if this is a write-only canvas
  if ((mWriteOnly) &&
      !nsContentUtils::IsCallerTrustedForRead()) {
    return NS_ERROR_DOM_SECURITY_ERR;
  }

  return MozGetAsFileImpl(aName, aType, aResult);
}

nsresult
nsHTMLCanvasElement::MozGetAsFileImpl(const nsAString& aName,
                                      const nsAString& aType,
                                      nsIDOMFile** aResult)
{
  bool fallbackToPNG = false;
  PRUint32 imgSize = 0;
  char* imgData;

  nsresult rv = ExtractData(aType, EmptyString(), imgData,
                            imgSize, fallbackToPNG);
  NS_ENSURE_SUCCESS(rv, rv);

  nsAutoString type(aType);
  if (fallbackToPNG) {
    type.AssignLiteral("image/png");
  }

  // The DOMFile takes ownership of the buffer
  nsRefPtr<nsDOMMemoryFile> file =
    new nsDOMMemoryFile((void*)imgData, imgSize, aName, type);

  return CallQueryInterface(file, aResult);
}

nsresult
nsHTMLCanvasElement::GetContextHelper(const nsAString& aContextId,
                                      nsICanvasRenderingContextInternal **aContext)
{
  NS_ENSURE_ARG(aContext);

  NS_LossyConvertUTF16toASCII ctxId(aContextId);

  // check that ctxId is clamped to A-Za-z0-9_-
  for (PRUint32 i = 0; i < ctxId.Length(); i++) {
    if ((ctxId[i] < 'A' || ctxId[i] > 'Z') &&
        (ctxId[i] < 'a' || ctxId[i] > 'z') &&
        (ctxId[i] < '0' || ctxId[i] > '9') &&
        (ctxId[i] != '-') &&
        (ctxId[i] != '_'))
    {
      // XXX ERRMSG we need to report an error to developers here! (bug 329026)
      return NS_OK;
    }
  }

  nsCString ctxString("@mozilla.org/content/canvas-rendering-context;1?id=");
  ctxString.Append(ctxId);

  nsresult rv;
  nsCOMPtr<nsICanvasRenderingContextInternal> ctx =
    do_CreateInstance(nsPromiseFlatCString(ctxString).get(), &rv);
  if (rv == NS_ERROR_OUT_OF_MEMORY) {
    *aContext = nsnull;
    return NS_ERROR_OUT_OF_MEMORY;
  }
  if (NS_FAILED(rv)) {
    *aContext = nsnull;
    // XXX ERRMSG we need to report an error to developers here! (bug 329026)
    return NS_OK;
  }

  rv = ctx->SetCanvasElement(this);
  if (NS_FAILED(rv)) {
    *aContext = nsnull;
    return rv;
  }

  *aContext = ctx.forget().get();

  return rv;
}

NS_IMETHODIMP
nsHTMLCanvasElement::GetContext(const nsAString& aContextId,
                                const jsval& aContextOptions,
                                nsISupports **aContext)
{
  nsresult rv;

  if (mCurrentContextId.IsEmpty()) {
    rv = GetContextHelper(aContextId, getter_AddRefs(mCurrentContext));
    NS_ENSURE_SUCCESS(rv, rv);
    if (!mCurrentContext) {
      return NS_OK;
    }

    // Ensure that the context participates in CC.  Note that returning a
    // CC participant from QI doesn't addref.
    nsXPCOMCycleCollectionParticipant *cp = nsnull;
    CallQueryInterface(mCurrentContext, &cp);
    if (!cp) {
      mCurrentContext = nsnull;
      return NS_ERROR_FAILURE;
    }

    rv = mCurrentContext->SetCanvasElement(this);
    if (NS_FAILED(rv)) {
      mCurrentContext = nsnull;
      return rv;
    }

    nsCOMPtr<nsIPropertyBag> contextProps;
    if (!JSVAL_IS_NULL(aContextOptions) &&
        !JSVAL_IS_VOID(aContextOptions))
    {
      JSContext *cx = nsContentUtils::GetCurrentJSContext();

      nsCOMPtr<nsIWritablePropertyBag2> newProps;

      // note: if any contexts end up supporting something other
      // than objects, e.g. plain strings, then we'll need to expand
      // this to know how to create nsISupportsStrings etc.
      if (JSVAL_IS_OBJECT(aContextOptions)) {
        newProps = do_CreateInstance("@mozilla.org/hash-property-bag;1");

        JSObject *opts = JSVAL_TO_OBJECT(aContextOptions);
        JSIdArray *props = JS_Enumerate(cx, opts);
        for (int i = 0; props && i < props->length; ++i) {
          jsid propid = props->vector[i];
          jsval propname, propval;
          if (!JS_IdToValue(cx, propid, &propname) ||
              !JS_GetPropertyById(cx, opts, propid, &propval))
          {
            continue;
          }

          JSString *propnameString = JS_ValueToString(cx, propname);
          nsDependentJSString pstr;
          if (!propnameString || !pstr.init(cx, propnameString)) {
            mCurrentContext = nsnull;
            return NS_ERROR_FAILURE;
          }

          if (JSVAL_IS_BOOLEAN(propval)) {
            newProps->SetPropertyAsBool(pstr, propval == JSVAL_TRUE ? PR_TRUE : PR_FALSE);
          } else if (JSVAL_IS_INT(propval)) {
            newProps->SetPropertyAsInt32(pstr, JSVAL_TO_INT(propval));
          } else if (JSVAL_IS_DOUBLE(propval)) {
            newProps->SetPropertyAsDouble(pstr, JSVAL_TO_DOUBLE(propval));
          } else if (JSVAL_IS_STRING(propval)) {
            JSString *propvalString = JS_ValueToString(cx, propval);
            nsDependentJSString vstr;
            if (!propvalString || !vstr.init(cx, propvalString)) {
              mCurrentContext = nsnull;
              return NS_ERROR_FAILURE;
            }

            newProps->SetPropertyAsAString(pstr, vstr);
          }
        }
      }

      contextProps = newProps;
    }

    rv = UpdateContext(contextProps);
    if (NS_FAILED(rv)) {
      mCurrentContext = nsnull;
      return rv;
    }

    mCurrentContextId.Assign(aContextId);
  } else if (!mCurrentContextId.Equals(aContextId)) {
    //XXX eventually allow for more than one active context on a given canvas
    return NS_OK;
  }

  NS_ADDREF (*aContext = mCurrentContext);
  return NS_OK;
}

NS_IMETHODIMP
nsHTMLCanvasElement::MozGetIPCContext(const nsAString& aContextId,
                                      nsISupports **aContext)
{
  if(!nsContentUtils::IsCallerTrustedForRead()) {
    // XXX ERRMSG we need to report an error to developers here! (bug 329026)
    return NS_ERROR_DOM_SECURITY_ERR;
  }

  // We only support 2d shmem contexts for now.
  if (!aContextId.Equals(NS_LITERAL_STRING("2d")))
    return NS_ERROR_INVALID_ARG;

  nsresult rv;

  if (mCurrentContextId.IsEmpty()) {
    rv = GetContextHelper(aContextId, getter_AddRefs(mCurrentContext));
    NS_ENSURE_SUCCESS(rv, rv);
    if (!mCurrentContext) {
      return NS_OK;
    }

    mCurrentContext->SetIsIPC(PR_TRUE);

    rv = UpdateContext();
    if (NS_FAILED(rv)) {
      mCurrentContext = nsnull;
      return rv;
    }

    mCurrentContextId.Assign(aContextId);
  } else if (!mCurrentContextId.Equals(aContextId)) {
    //XXX eventually allow for more than one active context on a given canvas
    return NS_ERROR_INVALID_ARG;
  }

  NS_ADDREF (*aContext = mCurrentContext);
  return NS_OK;
}

nsresult
nsHTMLCanvasElement::UpdateContext(nsIPropertyBag *aNewContextOptions)
{
  if (!mCurrentContext)
    return NS_OK;

  nsresult rv = NS_OK;

  rv = mCurrentContext->SetIsOpaque(GetIsOpaque());
  if (NS_FAILED(rv))
    return rv;

  rv = mCurrentContext->SetContextOptions(aNewContextOptions);
  if (NS_FAILED(rv))
    return rv;

  nsIntSize sz = GetWidthHeight();
  rv = mCurrentContext->SetDimensions(sz.width, sz.height);
  if (NS_FAILED(rv))
    return rv;

  return rv;
}

nsIFrame *
nsHTMLCanvasElement::GetPrimaryCanvasFrame()
{
  return GetPrimaryFrame(Flush_Frames);
}

nsIntSize
nsHTMLCanvasElement::GetSize()
{
  return GetWidthHeight();
}

PRBool
nsHTMLCanvasElement::IsWriteOnly()
{
  return mWriteOnly;
}

void
nsHTMLCanvasElement::SetWriteOnly()
{
  mWriteOnly = PR_TRUE;
}

void
nsHTMLCanvasElement::InvalidateCanvasContent(const gfxRect* damageRect)
{
  // We don't need to flush anything here; if there's no frame or if
  // we plan to reframe we don't need to invalidate it anyway.
  nsIFrame *frame = GetPrimaryFrame();
  if (!frame)
    return;

  frame->MarkLayersActive();

  nsRect invalRect;
  nsRect contentArea = frame->GetContentRect();
  if (damageRect) {
    nsIntSize size = GetWidthHeight();

    // damageRect and size are in CSS pixels; contentArea is in appunits
    // We want a rect in appunits; so avoid doing pixels-to-appunits and
    // vice versa conversion here.
    gfxRect realRect(*damageRect);
    realRect.Scale(contentArea.width / gfxFloat(size.width),
                   contentArea.height / gfxFloat(size.height));
    realRect.RoundOut();

    // then make it a nsRect
    invalRect = nsRect(realRect.X(), realRect.Y(),
                       realRect.Width(), realRect.Height());
  } else {
    invalRect = nsRect(nsPoint(0, 0), contentArea.Size());
  }
  invalRect.MoveBy(contentArea.TopLeft() - frame->GetPosition());

  Layer* layer = frame->InvalidateLayer(invalRect, nsDisplayItem::TYPE_CANVAS);
  if (layer) {
    static_cast<CanvasLayer*>(layer)->Updated();
  }
}

void
nsHTMLCanvasElement::InvalidateCanvas()
{
  // We don't need to flush anything here; if there's no frame or if
  // we plan to reframe we don't need to invalidate it anyway.
  nsIFrame *frame = GetPrimaryFrame();
  if (!frame)
    return;

  frame->Invalidate(frame->GetContentRect() - frame->GetPosition());
}

PRInt32
nsHTMLCanvasElement::CountContexts()
{
  if (mCurrentContext)
    return 1;

  return 0;
}

nsICanvasRenderingContextInternal *
nsHTMLCanvasElement::GetContextAtIndex (PRInt32 index)
{
  if (mCurrentContext && index == 0)
    return mCurrentContext.get();

  return NULL;
}

PRBool
nsHTMLCanvasElement::GetIsOpaque()
{
  return HasAttr(kNameSpaceID_None, nsGkAtoms::moz_opaque);
}

already_AddRefed<CanvasLayer>
nsHTMLCanvasElement::GetCanvasLayer(nsDisplayListBuilder* aBuilder,
                                    CanvasLayer *aOldLayer,
                                    LayerManager *aManager)
{
  if (!mCurrentContext)
    return nsnull;

  return mCurrentContext->GetCanvasLayer(aBuilder, aOldLayer, aManager);
}

void
nsHTMLCanvasElement::MarkContextClean()
{
  if (!mCurrentContext)
    return;

  mCurrentContext->MarkContextClean();
}

NS_IMETHODIMP_(nsIntSize)
nsHTMLCanvasElement::GetSizeExternal()
{
  return GetWidthHeight();
}

NS_IMETHODIMP
nsHTMLCanvasElement::RenderContextsExternal(gfxContext *aContext, gfxPattern::GraphicsFilter aFilter)
{
  if (!mCurrentContext)
    return NS_OK;

  return mCurrentContext->Render(aContext, aFilter);
}
