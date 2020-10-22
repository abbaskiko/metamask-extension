import { createSlice } from '@reduxjs/toolkit'
import BigNumber from 'bignumber.js'
import log from 'loglevel'

import {
  loadLocalStorageData,
  saveLocalStorageData,
} from '../../../lib/local-storage-helpers'
import {
  addToken,
  addUnapprovedTransaction,
  fetchAndSetQuotes,
  forceUpdateMetamaskState,
  resetSwapsPostFetchState,
  setBackgroundSwapRouteState,
  setInitialGasEstimate,
  setSwapsErrorKey,
  setSwapsTxGasPrice,
  setApproveTxId,
  setTradeTxId,
  stopPollingForQuotes,
  updateAndApproveTx,
  updateTransaction,
  resetBackgroundSwapsState,
  setSwapsLiveness,
} from '../../store/actions'
import { AWAITING_SWAP_ROUTE, BUILD_QUOTE_ROUTE, LOADING_QUOTES_ROUTE, SWAPS_ERROR_ROUTE, SWAPS_MAINTENANCE_ROUTE } from '../../helpers/constants/routes'
import { fetchSwapsFeatureLiveness, fetchSwapsGasPrices } from '../../pages/swaps/swaps.util'
import { calcGasTotal } from '../../pages/send/send.utils'
import { decimalToHex, getValueFromWeiHex, hexMax, decGWEIToHexWEI, hexToDecimal, decEthToConvertedCurrency, hexWEIToDecGWEI } from '../../helpers/utils/conversions.util'
import { conversionGreaterThan } from '../../helpers/utils/conversion-util'
import { calcTokenAmount } from '../../helpers/utils/token-util'
import {
  getFastPriceEstimateInHexWEI,
  getSelectedAccount,
  getTokenExchangeRates,
  conversionRateSelector as getConversionRate,
} from '../../selectors'
import {
  ERROR_FETCHING_QUOTES,
  QUOTES_NOT_AVAILABLE_ERROR,
  ETH_SWAPS_TOKEN_OBJECT,
  SWAP_FAILED_ERROR,
} from '../../helpers/constants/swaps'
import { SWAP, SWAP_APPROVAL } from '../../helpers/constants/transactions'
import { resetCustomGasState } from '../gas/gas.duck'
import { formatCurrency } from '../../helpers/utils/confirm-tx.util'

const initialState = {
  aggregatorMetadata: null,
  approveTxId: null,
  balanceError: false,
  fetchingQuotes: false,
  fromToken: null,
  quotesFetchStartTime: null,
  topAssets: {},
  toToken: null,
  customGas: {
    price: null,
    limit: null,
    loading: false,
    priceEstimates: {},
    priceEstimatesLastRetrieved: 0,
  },
}

const slice = createSlice({
  name: 'swaps',
  initialState,
  reducers: {
    clearSwapsState: () => initialState,
    navigatedBackToBuildQuote: (state) => {
      state.approveTxId = null
      state.balanceError = false
      state.fetchingQuotes = false
    },
    retriedGetQuotes: (state) => {
      state.approveTxId = null
      state.balanceError = false
      state.fetchingQuotes = false
    },
    setAggregatorMetadata: (state, action) => {
      state.aggregatorMetadata = action.payload
    },
    setBalanceError: (state, action) => {
      state.balanceError = action.payload
    },
    setFetchingQuotes: (state, action) => {
      state.fetchingQuotes = action.payload
    },
    setFromToken: (state, action) => {
      state.fromToken = action.payload
    },
    setQuotesFetchStartTime: (state, action) => {
      state.quotesFetchStartTime = action.payload
    },
    setTopAssets: (state, action) => {
      state.topAssets = action.payload
    },
    setToToken: (state, action) => {
      state.toToken = action.payload
    },
    setSwapsCustomizationModalPrice: (state, action) => {
      state.customGas = {
        ...state.customGas,
        price: action.payload,
      }
    },
    setSwapsCustomizationModalLimit: (state, action) => {
      state.customGas = {
        ...state.customGas,
        limit: action.payload,
      }
    },
    setSwapGasPriceEstimatesLoadingState: (state, action) => {
      state.customGas = {
        ...state.customGas,
        loading: action.payload,
      }
    },
    setSwapGasPriceEstimates: (state, action) => {
      state.customGas = {
        ...state.customGas,
        priceEstimates: action.payload,
      }
    },
    setSwapsGasPriceEstimatesLastRetrieved: (state, action) => {
      state.customGas = {
        ...state.customGas,
        priceEstimatesLastRetrieved: action.payload,
      }
    },
  },
})

const { actions, reducer } = slice

export default reducer

// Selectors

export const getAggregatorMetadata = (state) => state.swaps.aggregatorMetadata

export const getBalanceError = (state) => state.swaps.balanceError

export const getFromToken = (state) => state.swaps.fromToken

export const getTopAssets = (state) => state.swaps.topAssets

export const getToToken = (state) => state.swaps.toToken

export const getFetchingQuotes = (state) => state.swaps.fetchingQuotes

export const getQuotesFetchStartTime = (state) => state.swaps.quotesFetchStartTime

export const getSwapsCustomizationModalPrice = (state) => state.swaps.customGas.price

export const getSwapsCustomizationModalLimit = (state) => state.swaps.customGas.limit

export const getSwapGasEstimateLoadingStatus = (state) => state.swaps.customGas.loading

export const getSwapGasPriceEstimateData = (state) => state.swaps.customGas.priceEstimates

export const getSwapsPriceEstimatesLastRetrieved = (state) => state.swaps.customGas.priceEstimatesLastRetrieved

export function isCustomSwapsGasPriceSafe (state) {
  const { average } = getSwapGasPriceEstimateData(state)

  const customGasPrice = getSwapsCustomizationModalPrice(state)

  if (!customGasPrice) {
    return true
  }

  if (average === null) {
    return false
  }

  const customPriceSafe = conversionGreaterThan(
    {
      value: customGasPrice,
      fromNumericBase: 'hex',
      fromDenomination: 'WEI',
      toDenomination: 'GWEI',
    },
    { value: average, fromNumericBase: 'dec' },
  )

  return customPriceSafe
}

// Background selectors

const getSwapsState = (state) => state.metamask.swapsState

export const getSwapsFeatureLiveness = (state) => state.metamask.swapsState.swapsFeatureIsLive

export const getBackgroundSwapRouteState = (state) => state.metamask.swapsState.routeState

export const getCustomSwapsGas = (state) => state.metamask.swapsState.customMaxGas

export const getCustomSwapsGasPrice = (state) => state.metamask.swapsState.customGasPrice

export const getFetchParams = (state) => state.metamask.swapsState.fetchParams

export const getQuotes = (state) => state.metamask.swapsState.quotes

export const getQuotesLastFetched = (state) => state.metamask.swapsState.quotesLastFetched

export const getSelectedQuote = (state) => {
  const { selectedAggId, quotes } = getSwapsState(state)
  return quotes[selectedAggId]
}

export const getSwapsErrorKey = (state) => getSwapsState(state)?.errorKey

export const getShowQuoteLoadingScreen = (state) => state.swaps.showQuoteLoadingScreen

export const getSwapsTokens = (state) => state.metamask.swapsState.tokens

export const getSwapsWelcomeMessageSeenStatus = (state) => state.metamask.swapsWelcomeMessageHasBeenShown

export const getTopQuote = (state) => {
  const { topAggId, quotes } = getSwapsState(state)
  return quotes[topAggId]
}

export const getApproveTxId = (state) => state.metamask.swapsState.approveTxId

export const getTradeTxId = (state) => state.metamask.swapsState.tradeTxId

export const getUsedQuote = (state) => getSelectedQuote(state) || getTopQuote(state)

// Compound selectors

export const getDestinationTokenInfo = (state) => getFetchParams(state)?.metaData?.destinationTokenInfo

export const getSwapsTradeTxParams = (state) => {
  const { selectedAggId, topAggId, quotes } = getSwapsState(state)
  const usedQuote = selectedAggId ? quotes[selectedAggId] : quotes[topAggId]
  if (!usedQuote) {
    return null
  }
  const { trade } = usedQuote
  const gas = getCustomSwapsGas(state) || trade.gas
  const gasPrice = getCustomSwapsGasPrice(state) || trade.gasPrice
  return { ...trade, gas, gasPrice }
}

export const getApproveTxParams = (state) => {
  const { approvalNeeded } = getSelectedQuote(state) || getTopQuote(state) || {}

  if (!approvalNeeded) {
    return null
  }
  const data = getSwapsState(state)?.customApproveTxData || approvalNeeded.data

  const gasPrice = getCustomSwapsGasPrice(state) || approvalNeeded.gasPrice
  return { ...approvalNeeded, gasPrice, data }
}

// Actions / action-creators

const {
  clearSwapsState,
  navigatedBackToBuildQuote,
  retriedGetQuotes,
  setAggregatorMetadata,
  setBalanceError,
  setFetchingQuotes,
  setFromToken,
  setQuotesFetchStartTime,
  setTopAssets,
  setToToken,
  setSwapsCustomizationModalPrice,
  setSwapsCustomizationModalLimit,
  setSwapGasPriceEstimatesLoadingState,
  setSwapGasPriceEstimates,
  setSwapsGasPriceEstimatesLastRetrieved,
} = actions

export {
  clearSwapsState,
  setAggregatorMetadata,
  setBalanceError,
  setFetchingQuotes,
  setFromToken as setSwapsFromToken,
  setQuotesFetchStartTime as setSwapQuotesFetchStartTime,
  setTopAssets,
  setToToken as setSwapToToken,
  setSwapsCustomizationModalPrice,
  setSwapsCustomizationModalLimit,
}

export const navigateBackToBuildQuote = (history) => {
  return async (dispatch) => {
    // TODO: Ensure any fetch in progress is cancelled
    await dispatch(resetSwapsPostFetchState())
    dispatch(navigatedBackToBuildQuote())

    history.push(BUILD_QUOTE_ROUTE)
  }
}

export const prepareForRetryGetQuotes = () => {
  return async (dispatch) => {
    // TODO: Ensure any fetch in progress is cancelled
    await dispatch(resetSwapsPostFetchState())
    dispatch(retriedGetQuotes())
  }
}

export const prepareToLeaveSwaps = () => {
  return async (dispatch) => {
    dispatch(resetCustomGasState())
    dispatch(clearSwapsState())
    await dispatch(resetBackgroundSwapsState())

  }
}

export const fetchAndSetSwapsGasPriceInfo = () => {
  return async (dispatch) => {
    const basicEstimates = await dispatch(fetchMetaSwapsGasPriceEstimates())
    dispatch(setSwapsTxGasPrice(decGWEIToHexWEI(basicEstimates.fast)))
  }
}

export const fetchQuotesAndSetQuoteState = (history, inputValue, maxSlippage, metaMetricsEvent) => {
  return async (dispatch, getState) => {
    let swapsFeatureIsLive = false
    try {
      swapsFeatureIsLive = await fetchSwapsFeatureLiveness()
    } catch (error) {
      log.error('Failed to fetch Swaps liveness, defaulting to false.', error)
    }
    await dispatch(setSwapsLiveness(swapsFeatureIsLive))

    if (!swapsFeatureIsLive) {
      await history.push(SWAPS_MAINTENANCE_ROUTE)
      return
    }

    const state = getState()
    const fetchParams = getFetchParams(state)
    const selectedAccount = getSelectedAccount(state)
    const balanceError = getBalanceError(state)
    const fetchParamsFromToken = fetchParams?.metaData?.sourceTokenInfo?.symbol === 'ETH' ?
      {
        ...ETH_SWAPS_TOKEN_OBJECT,
        string: getValueFromWeiHex({ value: selectedAccount.balance, numberOfDecimals: 4, toDenomination: 'ETH' }),
        balance: hexToDecimal(selectedAccount.balance),
      } :
      fetchParams?.metaData?.sourceTokenInfo
    const selectedFromToken = getFromToken(state) || fetchParamsFromToken || {}
    const selectedToToken = getToToken(state) || fetchParams?.metaData?.destinationTokenInfo || {}
    const {
      address: fromTokenAddress,
      symbol: fromTokenSymbol,
      decimals: fromTokenDecimals,
      iconUrl: fromTokenIconUrl,
      balance: fromTokenBalance,
    } = selectedFromToken
    const {
      address: toTokenAddress,
      symbol: toTokenSymbol,
      decimals: toTokenDecimals,
      iconUrl: toTokenIconUrl,
    } = selectedToToken
    await dispatch(setBackgroundSwapRouteState('loading'))
    history.push(LOADING_QUOTES_ROUTE)
    dispatch(setFetchingQuotes(true))

    const contractExchangeRates = getTokenExchangeRates(state)

    let destinationTokenAddedForSwap = false
    if (toTokenSymbol !== 'ETH' && !contractExchangeRates[toTokenAddress]) {
      destinationTokenAddedForSwap = true
      await dispatch(addToken(toTokenAddress, toTokenSymbol, toTokenDecimals, toTokenIconUrl, true))
    }
    if (fromTokenSymbol !== 'ETH' && !contractExchangeRates[fromTokenAddress] && fromTokenBalance && (new BigNumber(fromTokenBalance, 16)).gt(0)) {
      dispatch(addToken(fromTokenAddress, fromTokenSymbol, fromTokenDecimals, fromTokenIconUrl, true))
    }

    const swapsTokens = getSwapsTokens(state)

    const sourceTokenInfo = swapsTokens?.find(({ address }) => address === fromTokenAddress) || selectedFromToken
    const destinationTokenInfo = swapsTokens?.find(({ address }) => address === toTokenAddress) || selectedToToken

    dispatch(setFromToken(selectedFromToken))

    metaMetricsEvent({
      event: 'Quotes Requested',
      category: 'swaps',
    })
    metaMetricsEvent({
      event: 'Quotes Requested',
      category: 'swaps',
      excludeMetaMetricsId: true,
      properties: {
        token_from: fromTokenSymbol,
        token_from_amount: String(inputValue),
        token_to: toTokenSymbol,
        request_type: balanceError ? 'Quote' : 'Order',
        slippage: maxSlippage,
        custom_slippage: maxSlippage !== 2,
        anonymizedData: true,
      },
    })

    try {
      const fetchStartTime = Date.now()
      dispatch(setQuotesFetchStartTime(fetchStartTime))

      const fetchAndSetQuotesPromise = dispatch(fetchAndSetQuotes(
        {
          slippage: maxSlippage,
          sourceToken: fromTokenAddress,
          destinationToken: toTokenAddress,
          value: inputValue,
          fromAddress: selectedAccount.address,
          destinationTokenAddedForSwap,
          balanceError,
          sourceDecimals: fromTokenDecimals,
        },
        {
          sourceTokenInfo,
          destinationTokenInfo,
          accountBalance: selectedAccount.balance,
        },
      ))

      const gasPriceFetchPromise = dispatch(fetchAndSetSwapsGasPriceInfo())

      const [[fetchedQuotes, selectedAggId]] = await Promise.all([fetchAndSetQuotesPromise, gasPriceFetchPromise])

      if (Object.values(fetchedQuotes)?.length === 0) {
        metaMetricsEvent({
          event: 'No Quotes Available',
          category: 'swaps',
        })
        metaMetricsEvent({
          event: 'No Quotes Available',
          category: 'swaps',
          excludeMetaMetricsId: true,
          properties: {
            token_from: fromTokenSymbol,
            token_from_amount: String(inputValue),
            token_to: toTokenSymbol,
            request_type: balanceError ? 'Quote' : 'Order',
            slippage: maxSlippage,
            custom_slippage: maxSlippage !== 2,
          },
        })
        dispatch(setSwapsErrorKey(QUOTES_NOT_AVAILABLE_ERROR))
      } else {
        const newSelectedQuote = fetchedQuotes[selectedAggId]

        metaMetricsEvent({
          event: 'Quotes Received',
          category: 'swaps',
        })
        metaMetricsEvent({
          event: 'Quotes Received',
          category: 'swaps',
          excludeMetaMetricsId: true,
          properties: {
            token_from: fromTokenSymbol,
            token_from_amount: String(inputValue),
            token_to: toTokenSymbol,
            token_to_amount: calcTokenAmount(newSelectedQuote.destinationAmount, newSelectedQuote.decimals || 18),
            request_type: balanceError ? 'Quote' : 'Order',
            slippage: maxSlippage,
            custom_slippage: maxSlippage !== 2,
            response_time: Date.now() - fetchStartTime,
            best_quote_source: newSelectedQuote.aggregator,
            available_quotes: Object.values(fetchedQuotes)?.length,
            anonymizedData: true,
          },
        })

        dispatch(setInitialGasEstimate(selectedAggId))
      }
    } catch (e) {
      dispatch(setSwapsErrorKey(ERROR_FETCHING_QUOTES))
    }

    dispatch(setFetchingQuotes(false))
  }
}

export const signAndSendTransactions = (history, metaMetricsEvent) => {
  return async (dispatch, getState) => {
    let swapsFeatureIsLive = false
    try {
      swapsFeatureIsLive = await fetchSwapsFeatureLiveness()
    } catch (error) {
      log.error('Failed to fetch Swaps liveness, defaulting to false.', error)
    }
    await dispatch(setSwapsLiveness(swapsFeatureIsLive))

    if (!swapsFeatureIsLive) {
      await history.push(SWAPS_MAINTENANCE_ROUTE)
      return
    }

    const state = getState()
    const customSwapsGas = getCustomSwapsGas(state)
    const fetchParams = getFetchParams(state)
    const { metaData, value: swapTokenValue, slippage } = fetchParams
    const { sourceTokenInfo = {}, destinationTokenInfo = {} } = metaData
    await dispatch(setBackgroundSwapRouteState('awaiting'))
    await dispatch(stopPollingForQuotes())
    history.push(AWAITING_SWAP_ROUTE)

    const usedQuote = getUsedQuote(state)
    const usedTradeTxParams = usedQuote.trade

    const estimatedGasLimit = new BigNumber(usedQuote?.gasEstimate || decimalToHex(usedQuote?.averageGas || 0), 16)
    const estimatedGasLimitWithMultiplier = estimatedGasLimit.times(1.4, 10).round(0).toString(16)
    const maxGasLimit = customSwapsGas || hexMax((`0x${decimalToHex(usedQuote?.maxGas || 0)}`), estimatedGasLimitWithMultiplier)
    usedTradeTxParams.gas = maxGasLimit

    const customConvertGasPrice = getCustomSwapsGasPrice(state)
    const tradeTxParams = getSwapsTradeTxParams(state)
    const fastGasEstimate = getFastPriceEstimateInHexWEI(state)
    const usedGasPrice = customConvertGasPrice || tradeTxParams?.gasPrice || fastGasEstimate
    usedTradeTxParams.gasPrice = usedGasPrice

    const conversionRate = getConversionRate(state)
    const destinationValue = calcTokenAmount(usedQuote.destinationAmount, destinationTokenInfo.decimals || 18).toPrecision(8)
    const usedGasLimitEstimate = usedQuote?.gasEstimateWithRefund || (`0x${decimalToHex(usedQuote?.averageGas || 0)}`)
    const totalGasLimitEstimate = (new BigNumber(usedGasLimitEstimate, 16)).plus(usedQuote.approvalNeeded?.gas || '0x0', 16).toString(16)
    const gasEstimateTotalInEth = getValueFromWeiHex({
      value: calcGasTotal(totalGasLimitEstimate, usedGasPrice),
      toCurrency: 'usd',
      conversionRate,
      numberOfDecimals: 6,
    })
    const averageSavings = usedQuote.isBestQuote
      ? decEthToConvertedCurrency(
        usedQuote.savings?.total,
        'usd',
        conversionRate,
      )
      : null
    const swapMetaData = {
      token_from: sourceTokenInfo.symbol,
      token_from_amount: String(swapTokenValue),
      token_to: destinationTokenInfo.symbol,
      token_to_amount: destinationValue,
      slippage,
      custom_slippage: slippage !== 2,
      best_quote_source: getTopQuote(state)?.aggregator,
      available_quotes: getQuotes(state)?.length,
      other_quote_selected: usedQuote.aggregator !== getTopQuote(state)?.aggregator,
      other_quote_selected_source: usedQuote.aggregator === getTopQuote(state)?.aggregator ? '' : usedQuote.aggregator,
      gas_fees: formatCurrency(gasEstimateTotalInEth, 'usd')?.slice(1),
      estimated_gas: estimatedGasLimit.toString(10),
      suggested_gas_price: hexWEIToDecGWEI(usedGasPrice),
      used_gas_price: hexWEIToDecGWEI(fastGasEstimate),
      average_savings: averageSavings,
    }

    const metaMetricsConfig = {
      event: 'Swap Started',
      category: 'swaps',
    }

    metaMetricsEvent({ ...metaMetricsConfig })
    metaMetricsEvent({ ...metaMetricsConfig, excludeMetaMetricsId: true, properties: swapMetaData })

    let finalApproveTxMeta
    const approveTxParams = getApproveTxParams(state)
    if (approveTxParams) {
      const approveTxMeta = await dispatch(addUnapprovedTransaction({ ...approveTxParams, amount: '0x0' }, 'metamask'))
      await dispatch(setApproveTxId(approveTxMeta.id))
      finalApproveTxMeta = await (dispatch(updateTransaction({
        ...approveTxMeta,
        transactionCategory: SWAP_APPROVAL,
        sourceTokenSymbol: sourceTokenInfo.symbol,
      }, true)))
      try {
        await dispatch(updateAndApproveTx(finalApproveTxMeta, true))
      } catch (e) {
        await dispatch(setSwapsErrorKey(SWAP_FAILED_ERROR))
        history.push(SWAPS_ERROR_ROUTE)
        return
      }
    }

    const tradeTxMeta = await dispatch(addUnapprovedTransaction(usedTradeTxParams, 'metamask'))
    dispatch(setTradeTxId(tradeTxMeta.id))
    const finalTradeTxMeta = await (dispatch(updateTransaction({
      ...tradeTxMeta,
      sourceTokenSymbol: sourceTokenInfo.symbol,
      destinationTokenSymbol: destinationTokenInfo.symbol,
      transactionCategory: SWAP,
      destinationTokenDecimals: destinationTokenInfo.decimals,
      destinationTokenAddress: destinationTokenInfo.address,
      swapMetaData,
      swapTokenValue,
      approvalTxId: finalApproveTxMeta?.id,
    }, true)))
    try {
      await dispatch(updateAndApproveTx(finalTradeTxMeta, true))
    } catch (e) {
      await dispatch(setSwapsErrorKey(SWAP_FAILED_ERROR))
      history.push(SWAPS_ERROR_ROUTE)
      return
    }

    await forceUpdateMetamaskState(dispatch)
  }
}

export function fetchMetaSwapsGasPriceEstimates () {
  return async (dispatch, getState) => {
    const state = getState()
    const priceEstimatesLastRetrieved = getSwapsPriceEstimatesLastRetrieved(state)
    const timeLastRetrieved = priceEstimatesLastRetrieved || loadLocalStorageData('METASWAP_GAS_PRICE_ESTIMATES_LAST_RETRIEVED') || 0

    dispatch(setSwapGasPriceEstimatesLoadingState(true))

    let priceEstimates
    if (Date.now() - timeLastRetrieved > 30000) {
      priceEstimates = await fetchExternalMetaSwapGasPriceEstimates(dispatch)
    } else {
      const cachedPriceEstimates = loadLocalStorageData('METASWAP_GAS_PRICE_ESTIMATES')
      priceEstimates = cachedPriceEstimates || await fetchExternalMetaSwapGasPriceEstimates(dispatch)
    }

    dispatch(setSwapGasPriceEstimates(priceEstimates))
    dispatch(setSwapGasPriceEstimatesLoadingState(false))
    return priceEstimates
  }
}

async function fetchExternalMetaSwapGasPriceEstimates (dispatch) {
  const priceEstimates = await fetchSwapsGasPrices()

  const timeRetrieved = Date.now()
  saveLocalStorageData(priceEstimates, 'METASWAP_GAS_PRICE_ESTIMATES')
  saveLocalStorageData(timeRetrieved, 'METASWAP_GAS_PRICE_ESTIMATES_LAST_RETRIEVED')
  dispatch(setSwapsGasPriceEstimatesLastRetrieved(timeRetrieved))

  return priceEstimates
}
