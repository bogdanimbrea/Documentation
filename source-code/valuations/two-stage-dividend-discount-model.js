// +------------------------------------------------------------+
//   Model: Two-Stage Dividend Discount Model
//   © Copyright: https://discountingcashflows.com
// +------------------------------------------------------------+

Input(
  {
    _DISCOUNT_RATE: '',
    HIGH_GROWTH_YEARS: 5,
    HISTORICAL_YEARS: '',
    _HIGH_GROWTH_RATE: '',
    _HIGH_GROWTH_PAYOUT: '',
    _STABLE_GROWTH_IN_PERPETUITY: '',
    _STABLE_PAYOUT: '',
    BETA:'',
    _RISK_FREE_RATE: '',
    _MARKET_PREMIUM: '',
  },
  [{
    parent:'_DISCOUNT_RATE',
    children:['BETA', '_RISK_FREE_RATE', '_MARKET_PREMIUM']
  }]
);  

$.when(
  get_income_statement(),
  get_income_statement_ltm(),
  get_balance_sheet_statement(),
  get_balance_sheet_statement_quarterly(),
  get_cash_flow_statement(),
  get_cash_flow_statement_ltm(),
  get_profile(),
  get_dividends_annual(),
  get_prices_annual(),
  get_treasury(),
  get_fx(),
  get_risk_premium()).done(
  function($income, $income_ltm, $balance, $balance_quarterly, $flows, $flows_ltm, $profile, $dividends, $prices, $treasury, $fx, $risk_premium){
  try{
    var response = new Response({
      income: $income,
      income_ltm: $income_ltm,
      balance: $balance,
      balance_quarterly: $balance_quarterly,
      balance_ltm: 'balance_quarterly:0',
      flows: $flows,
      flows_ltm: $flows_ltm,
      profile: $profile,
      treasury: $treasury,
      dividends: $dividends,
      prices: $prices,
      risk_premium: $risk_premium,
    }).toOneCurrency('income', $fx).merge('_ltm');
    response.balance[0]['date'] = response.prices[0]['date'] = 'LTM';
    // +---------------- ASSUMPTIONS SECTION -----------------+ 
    // Count the dividends. If there are no dividends, display a warning.
    var dividendsCount = response.dividends.length - 1;
    if(dividendsCount <= 0){
      throwError("The company does not currently pay dividends!");
      return;
    }
    if(dividendsCount > 10){
    	setAssumption('HISTORICAL_YEARS', 10);
    }
    else{
      // Set the default historical years to the number of historical dividends
      setAssumption('HISTORICAL_YEARS', dividendsCount);
    }
    // Set the stable growth in perpetuity to the 10 year treasury note
    setAssumption('_STABLE_GROWTH_IN_PERPETUITY', response.treasury.year10);
	
    // Set beta 
    if(response.profile.beta){
    	setAssumption('BETA', response.profile.beta);
    }
    else{
    	setAssumption('BETA', 1);
    }
    // Risk free rate is the yield of the 10 year treasury note
	setAssumption('_RISK_FREE_RATE', response.treasury.year10);
    setAssumption('_MARKET_PREMIUM', response.risk_premium.totalEquityRiskPremium );
    // Discount Rate is the cost of equity
    setAssumption('_DISCOUNT_RATE', toP(getAssumption('_RISK_FREE_RATE') + getAssumption('BETA') * getAssumption('_MARKET_PREMIUM')));
    
    var sensitivity = 0.01;
    var prefDividendsRatio = absolute((response.income[0].eps * response.income[0].weightedAverageShsOut - response.income[0].netIncome) / response.income[0].netIncome);
    var commonIncome = [];
    if( prefDividendsRatio > sensitivity ){
      commonIncome = ['eps:0', '*', 'weightedAverageShsOut:0'];
    }
    else{
      commonIncome = ['netIncome:0'];
    }
    // Setup Original Data
    var original_data = new DateValueData({
      'netIncome': new DateValueList(response.income, 'netIncome'),
      'totalStockholdersEquity': new DateValueList(response.balance, 'totalStockholdersEquity'),
      'weightedAverageShsOut': new DateValueList(response.income, 'weightedAverageShsOut'),
      'eps': new DateValueList(response.income, 'eps'),
      'adjDividend': new DateValueList(response.dividends, 'adjDividend'),
      'marketPrice': new DateValueList(response.prices, 'close'),
    });
    var currentDate = original_data.lastDate();
    var nextYear = currentDate + 1;
    var forecastEndDate = currentDate + getAssumption('HIGH_GROWTH_YEARS');
    
    // Compute historical values and ratios
    var historical_computed_data = original_data.setFormula({
      'commonIncome': commonIncome,
      'preferredStockDividends': ['netIncome:0', '-', 'commonIncome:0'],
      'dividendsPaidToCommon': ['adjDividend:0', '*', 'weightedAverageShsOut:0'],
      'bookValue': ['totalStockholdersEquity:0', '/', 'weightedAverageShsOut:0'],
      '_returnOnEquity': ['commonIncome:0', '/', 'totalStockholdersEquity:-1'],
      '_payoutRatio': ['adjDividend:0', '/', 'eps:0'],
      'retainedEarnings': ['eps:0', '-', 'adjDividend:0'],
      '_dividendYield': ['adjDividend:0', '/', 'marketPrice:0'],
      '_adjDividendGrowth': ['function:growth_rate', 'adjDividend'],
      'discountedAdjDividend': ['adjDividend:0'],
    }).compute();
    
    var averageReturnOnEquity = historical_computed_data.get('_returnOnEquity').sublist(nextYear - getAssumption('HISTORICAL_YEARS')).average();
    setAssumption('_STABLE_PAYOUT', toP(1-getAssumption('_STABLE_GROWTH_IN_PERPETUITY')/averageReturnOnEquity));
    
    var averagePayoutRatio = historical_computed_data.get('_payoutRatio').sublist(nextYear - getAssumption('HISTORICAL_YEARS')).average();
    // If the payout is higher than 100%, set it equal to the stable payout
    if(averagePayoutRatio > 1){
      setAssumption('_HIGH_GROWTH_PAYOUT', toP(getAssumption('_STABLE_PAYOUT')));
    }
    else{
      setAssumption('_HIGH_GROWTH_PAYOUT', toP(averagePayoutRatio));
    }
    // averageDividendGrowthRate stores the Historical Dividend Growth Rate
    // TODO: Remove '+ 1' from nextYear + 1
    var averageDividendGrowthRate = historical_computed_data.get('_adjDividendGrowth').sublist(nextYear - getAssumption('HISTORICAL_YEARS')).average();
    // Set the eps high growth rate equal to the historical dividend growth rate
    setAssumption('_HIGH_GROWTH_RATE', toP(averageDividendGrowthRate));
    
    // Compute 5 years of forecasted values and ratios
    var forecasted_data = historical_computed_data.removeDate('LTM').setFormula({
      'linearRegressionEps': ['function:linear_regression', 'eps', {slope: 1, start_date: nextYear - getAssumption('HISTORICAL_YEARS')}],
      'eps': ['function:compound', 'eps:start_date', {rate: getAssumption('_HIGH_GROWTH_RATE'), start_date: currentDate}],
      'adjDividend': ['eps:0', '*', getAssumption('_HIGH_GROWTH_PAYOUT')],
      'discountedAdjDividend': ['function:discount', 'adjDividend', {rate: getAssumption('_DISCOUNT_RATE'), start_date: currentDate}],
      '_adjDividendGrowth': ['function:growth_rate', 'adjDividend'],
    }).setEditable(_edit(), {
      start_date: nextYear,
      keys: ['eps', 'adjDividend'],
    }).compute({'forecast_end_date': forecastEndDate});
    // +------------- END OF ASSUMPTIONS SECTION -------------+
    
    // +---------------- MODEL VALUES SECTION ----------------+
    // Discount the projected dividends and sum them
    var sumOfDiscountedDividends = forecasted_data.get('discountedAdjDividend').sublist(nextYear).sum();
    // Calculate the discounted terminal value
    var stableEps = forecasted_data.get('eps').lastValue() * (1 + getAssumption('_STABLE_GROWTH_IN_PERPETUITY'));
    var stableDividend = stableEps * getAssumption('_STABLE_PAYOUT');
    var terminalValue = stableDividend/(getAssumption('_DISCOUNT_RATE') - getAssumption('_STABLE_GROWTH_IN_PERPETUITY')); 
    var discountedTerminalValue = terminalValue/Math.pow(1 + getAssumption('_DISCOUNT_RATE'), getAssumption('HIGH_GROWTH_YEARS'));
    
    // The final value calculated by the Two-Stage Dividend Discount Model
    var valueOfStock = discountedTerminalValue + sumOfDiscountedDividends;
    
    var currency = response.currency;
    // If we are calculating the value per share for a watch, we can stop right here.
    if(_StopIfWatch(valueOfStock, currency)){
      return;
    }
    _SetEstimatedValue(valueOfStock, currency);
    print(sumOfDiscountedDividends, "Sum of discounted dividends", '#', currency);
    print(discountedTerminalValue, "Discounted terminal value", '#', currency);
    print(terminalValue, "Terminal value", '#', currency);
    print(stableDividend, "Dividend in stable phase", '#', currency);
    print(stableEps, "Eps in stable phase", '#', currency);
    print(averageDividendGrowthRate, "Average historical Dividend Growth Rate", '%');
    print(averagePayoutRatio, "Average historical Payout Ratio", '%');
    print(averageReturnOnEquity, "Average historical Return on Equity", '%');
    // +------------- END OF MODEL VALUES SECTION ------------+
    
    // +------------------- CHARTS SECTION -------------------+
    forecasted_data.renderChart({
      start_date: nextYear - getAssumption('HISTORICAL_YEARS'),
      keys: ['eps', 'adjDividend', 'linearRegressionEps', 'discountedAdjDividend'],
      properties: {
        title: 'Historical and Projected Dividends',
        currency: currency,
        disabled_keys: ['linearRegressionEps', 'discountedAdjDividend'],
      }
    });
    // +------------------- CHARTS SECTION -------------------+
    
    // +------------------- TABLES SECTION -------------------+
    // Dividend Table
    forecasted_data.renderTable({
      start_date: currentDate,
      keys: ['eps', 'adjDividend', '_adjDividendGrowth', 'discountedAdjDividend'],
      rows: ['EPS', 'Dividends', '{%} Dividend Growth Rate', 'Discounted Dividend'],
      properties: {
        'title': 'Projected data',
        'currency': currency,
      },
    });
    
    // Historical Table
    historical_computed_data.renderTable({
      start_date: nextYear - getAssumption('HISTORICAL_YEARS'),
      keys: ['netIncome', 'totalStockholdersEquity', '_returnOnEquity', 'dividendsPaidToCommon',
             '_payoutRatio', 'weightedAverageShsOut', 'marketPrice', 'eps', 'adjDividend', '_adjDividendGrowth', '_dividendYield'],
      rows: ['Net income', 'Equity', '{%} Return on equity', 'Dividends paid', 
             '{%} Payout ratio', 'Shares outstanding', '{PerShare} Reference market price', '{PerShare} EPS',
             '{PerShare} Dividends', '{%} Dividend Growth Rate', '{%} Dividend yield'],
      properties: {
        'title': 'Historical data',
        'currency': currency,
        'number_format': 'M',
        'display_averages': true,
        'column_order': 'descending',
      },
    });
    // +---------------- END OF TABLES SECTION ---------------+
  }
  catch (error) {
    throwError(error);
  }
});

Description(`
	<h5>Two-Stage Dividend Discount Model</h5>
	<p>Used to estimate the value of companies based on two stages of growth. An initial period of high growth, calculated using <b>[Sum of Discounted Dividends]</b>, followed by a period of stable growth, calculated using <b>[Discounted Terminal Value]</b>.</p>
	<p class='text-center'>Read more: <a href='https://github.com/DiscountingCashFlows/Documentation/blob/main/models-documentation/dividend-discount-models.md#two-stage-dividend-discount-model-source-code' target='_blank'><i class="fab fa-github"></i> GitHub Documentation</a></p>
`,
  {
    _DISCOUNT_RATE: [
      '{Equation} \\text{Discount Rate} = \\text{Equity Weight} * \\text{Cost of Equity} + \\text{Debt Weight} * \\text{Cost of Debt} * (1 - \\text{Tax Rate})',
      '{Paragraph} Calculated using Weighted Average Cost of Capital (WACC) formula. It represents a firm’s average after-tax cost of capital from all sources, including common stock, preferred stock, bonds, and other forms of debt.',
      '{Link} https://www.investopedia.com/terms/w/wacc.asp',
      
      '{Title} Cost of Equity',
      '{Equation} \\text{Cost of Equity} = \\text{Risk Free Rate} + \\text{Beta} * \\text{Market Premium}',
      '{Paragraph} The cost of equity is the theoretical rate of return that an equity investment should generate. It is calculated using the CAPM formula.',
      '{Link} https://www.investopedia.com/terms/c/costofequity.asp#mntl-sc-block_1-0-20',
      
      '{Title} Cost of Debt',
      '{Equation} \\text{Cost of Debt} = \\frac{\\text{Interest Expense}}{\\text{Total Debt}}',
      '{Paragraph} The cost of debt is the effective rate that a company pays on its debt, such as bonds and loans.',
      '{Link} https://www.investopedia.com/terms/c/costofdebt.asp',
      
      '{Title} Equity & Debt Weights',
      '{Equation} \\text{Debt Weight} = \\frac{\\text{Total Debt}}{\\text{Market Capitalization} + \\text{Total Debt}} = 1 - \\text{Equity Weight}',
      '{Paragraph} The Equity Weight represents the proportion of equity-based financing (Market Capitalization), while the Debt Weight represents the proportion of debt-based financing (Total Debt).',
      
      '{Title} Tax Rate',
      '{Equation} \\text{Tax Rate} = \\frac{\\text{Income Tax Expense}}{\\text{Income Before Tax}}',
      '{Paragraph} The overall tax rate paid by the company on its earned income.',
    ],
    _GROWTH_IN_PERPETUITY: 'The rate at which the company\'s free cash flow is assumed to grow in perpetuity. By default, this is equal to the yield of the U.S. 10 Year Treasury Bond.',
    _OPERATING_CASH_FLOW_MARGIN: [
      '{Equation} \\text{Projected Operating Cash Flow} = \\text{Projected Revenue} * \\text{Operating Cash Flow Margin}',
      'The margin used to project future Operating Cash Flow as a % from future Revenue.',
    ],
    _CAPITAL_EXPENDITURE_MARGIN: [
      '{Equation} \\text{Projected Free Cash Flow} = \\text{Projected Operating Cash Flow} - \\text{Projected Revenue} * \\text{Capital Expedinture Margin}',
      'The margin used to project future Capital Expedinture as a % from future Revenue, which is then used to calculate the Free Cash Flow.',
    ],	
    HISTORICAL_YEARS: 'Number of historical years used to calculate historical averages.',
    REVENUE_REGRESSION_SLOPE: `Future revenues are projected using a linear regression curve of past revenues.
      Set the slope:
      '>1' for a steeper revenue regression curve
      '0' for flat
      '<0' for inverse slope`,
    _RISK_FREE_RATE: 'The risk-free rate represents the interest an investor would expect from an absolutely risk-free investment over a specified period of time.'+
    ' By default, it is equal to the current yield of the U.S. 10 Year Treasury Bond.',
    _MARKET_PREMIUM: 'Market risk premium represents the excess returns over the risk-free rate that investors expect for taking on the incremental risks connected to the equities market.',
    BETA: 'Beta is a value that measures the price fluctuations (volatility) of a stock with respect to fluctuations in the overall stock market.',
  });
